import { toMatchQuery } from "../../search/tokenize";
import type { Db } from "../index";

/**
 * 站内搜索。设计见 docs/ARCHITECTURE.md §7，要点：
 *
 * - **排序是相关度优先**：bm25 升序（SQLite 里越负越相关），标题权重 5、正文 1；
 *   同分再按发布时间倒序，最后用 id 兜底，保证分页稳定、跨页不重复。
 * - **不给命中上下文**：`posts_fts` 是 contentless 表，`snippet()` / `highlight()` 取不到值，
 *   而硬性规则 1 也只允许渲染摘要。想提示「为什么命中」就用列过滤判断是不是标题命中。
 * - 不返回正文：这张库里没有正文，正文在 crawler 的私有目录。
 */

export interface SearchHit {
  id: number;
  title: string;
  summary: string;
  url: string;
  companySlug: string;
  companyName: string;
  publishedAt: string | null;
  publishedYear: number | null;
  /** 命中发生在标题上（正文命中为 false） */
  titleHit: boolean;
  score: number;
}

export interface SearchOptions {
  q: string;
  limit?: number;
  offset?: number;
  /** 只看某个公司（列表页二次过滤） */
  companySlug?: string;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  /** 归一后的查询串（分词后），空表示查询没有可用检索词 */
  normalizedQuery: string;
}

/** 查询串上限：超过这个长度的输入按截断处理，避免把整段正文塞进 MATCH */
const MAX_QUERY_CHARS = 120;

const VISIBLE = "p.is_visible = 1 and p.duplicate_of_id is null";

export function searchPosts(db: Db, options: SearchOptions): SearchResult {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const query = toMatchQuery(options.q.slice(0, MAX_QUERY_CHARS));

  if (!query) return { total: 0, hits: [], normalizedQuery: "" };

  const companyFilter = options.companySlug ? "and c.slug = ?" : "";
  const filterParams = options.companySlug ? [options.companySlug] : [];

  const total = (
    db.$client
      .prepare(
        `select count(*) as n
         from posts_fts
         join posts p on p.id = posts_fts.rowid
         join companies c on c.id = p.company_id
         where posts_fts match ? and ${VISIBLE} ${companyFilter}`,
      )
      .get(query, ...filterParams) as { n: number }
  ).n;

  const rows = db.$client
    .prepare(
      `select p.id as id,
              p.title as title,
              p.summary as summary,
              p.canonical_url as url,
              p.published_at as publishedAt,
              p.published_year as publishedYear,
              c.slug as companySlug,
              c.name as companyName,
              bm25(posts_fts, 5.0, 1.0) as score
       from posts_fts
       join posts p on p.id = posts_fts.rowid
       join companies c on c.id = p.company_id
       where posts_fts match ? and ${VISIBLE} ${companyFilter}
       order by score asc, coalesce(p.published_at, '') desc, p.id desc
       limit ? offset ?`,
    )
    .all(query, ...filterParams, limit, offset) as Omit<SearchHit, "titleHit">[];

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

  return {
    total,
    normalizedQuery: query,
    hits: rows.map((row) => ({ ...row, titleHit: titleHits.has(row.id) })),
  };
}
