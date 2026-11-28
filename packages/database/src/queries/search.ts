import { toMatchQuery } from "@boguan/search";
import type { Db } from "../connection";
import {
  attachPostTags,
  CARD_COLUMNS,
  filterSql,
  VISIBLE,
  type ListFilters,
  type PostCard,
} from "./posts";

export interface SearchHit extends PostCard {
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
  normalizedQuery: string;
}

const MAX_QUERY_CHARS = 120;

const HIT_COLUMNS = `${CARD_COLUMNS},
       bm25(posts_fts, 5.0, 1.0) as score`;

export function searchPosts(db: Db, options: SearchOptions): SearchResult {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const query = toMatchQuery(options.q.slice(0, MAX_QUERY_CHARS));

  if (!query) return { total: 0, hits: [], normalizedQuery: "" };

  const { where, params } = filterSql(options);
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
