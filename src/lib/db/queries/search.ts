import { toMatchQuery } from "../../search/tokenize";
import type { Db } from "../index";
import {
  attachPostTags,
  CARD_COLUMNS,
  filterSql,
  VISIBLE,
  type ListFilters,
  type PostCard,
} from "./posts";

/**
 * 站内搜索。设计见 docs/ARCHITECTURE.md §7，要点：
 *
 * - **排序是相关度优先**：bm25 升序（SQLite 里越负越相关），标题权重 5、正文 1；
 *   同分再按发布时间倒序，最后用 id 兜底，保证分页稳定、跨页不重复。
 * - **不给命中上下文**：`posts_fts` 是 contentless 表，`snippet()` / `highlight()` 取不到值，
 *   而硬性规则 1 也只允许渲染摘要。想提示「为什么命中」就用列过滤判断是不是标题命中。
 * - 不返回正文：这张库里没有正文，正文在 crawler 的私有目录。
 *
 * 可见性、过滤条件与卡片列与列表查询共用同一份实现（`posts.ts`），改动不会漏一边。
 */

export interface SearchHit extends PostCard {
  /** 命中发生在标题上（正文命中为 false） */
  titleHit: boolean;
  score: number;
}

export interface SearchOptions extends ListFilters {
  q: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  /** 归一后的查询串（分词后），空表示查询没有可用检索词 */
  normalizedQuery: string;
}

/** 查询串上限：超过这个长度的输入按截断处理，避免把整段正文塞进 MATCH */
const MAX_QUERY_CHARS = 120;

const HIT_COLUMNS = `${CARD_COLUMNS},
       bm25(posts_fts, 5.0, 1.0) as score`;

export function searchPosts(db: Db, options: SearchOptions): SearchResult {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const query = toMatchQuery(options.q.slice(0, MAX_QUERY_CHARS));

  if (!query) return { total: 0, hits: [], normalizedQuery: "" };

  const { where, params } = filterSql(options);
  // count 里 companies join 只在按公司过滤时才用得上；行查询的卡片列要 c.*，
  // 得始终带上
  const countFrom = options.companySlug
    ? `posts_fts
       join posts p on p.id = posts_fts.rowid
       join companies c on c.id = p.company_id`
    : `posts_fts
       join posts p on p.id = posts_fts.rowid`;
  const rowFrom = `posts_fts
       join posts p on p.id = posts_fts.rowid
       join companies c on c.id = p.company_id`;

  const total = (
    db.$client
      .prepare(
        `select count(*) as n from ${countFrom} where posts_fts match ? and ${VISIBLE} ${where}`,
      )
      .get(query, ...params) as { n: number }
  ).n;

  const rows = db.$client
    .prepare(
      `select ${HIT_COLUMNS}
       from ${rowFrom}
       where posts_fts match ? and ${VISIBLE} ${where}
       order by score asc, p.published_at desc, p.id desc
       limit ? offset ?`,
    )
    .all(query, ...params, limit, offset) as (Omit<SearchHit, "tags" | "titleHit"> & {
    score: number;
  })[];

  const titleHits = new Set<number>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    const titleRows = db.$client
      .prepare(
        `select rowid as id from posts_fts
         where posts_fts match ? and rowid in (${placeholders})`,
      )
      .all(`title_tokens : (${query})`, ...rows.map((row) => row.id)) as { id: number }[];
    for (const row of titleRows) titleHits.add(row.id);
  }

  const cards = attachPostTags(rows, db);

  return {
    total,
    normalizedQuery: query,
    hits: cards.map((card, index) => ({
      ...card,
      titleHit: titleHits.has(card.id),
      score: rows[index]!.score,
    })),
  };
}
