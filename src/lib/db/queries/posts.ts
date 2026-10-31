import type { Db } from "../index";

/**
 * 列表页的只读查询（docs/ARCHITECTURE.md §6）。
 *
 * 三条共同的规矩，集中在这里实现，页面不重复写：
 * 1. 只出 `is_visible = 1 and duplicate_of_id is null` 的帖子（下架与判重输掉的不出现）；
 * 2. 排序固定 `published_at desc nulls last, id desc`——缺时间的沉底，且分页稳定；
 * 3. 只选页面要用的列，正文不在这张库里，想选也选不到。
 */

export interface PostCard {
  id: number;
  title: string;
  summary: string;
  url: string;
  author: string | null;
  coverUrl: string | null;
  publishedAt: string | null;
  publishedYear: number | null;
  companySlug: string;
  companyName: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

const VISIBLE = "p.is_visible = 1 and p.duplicate_of_id is null";
const ORDER = "order by coalesce(p.published_at, '') desc, p.id desc";

const CARD_COLUMNS = `p.id as id,
       p.title as title,
       p.summary as summary,
       p.canonical_url as url,
       p.author as author,
       p.cover_url as coverUrl,
       p.published_at as publishedAt,
       p.published_year as publishedYear,
       c.slug as companySlug,
       c.name as companyName`;

const FROM = "from posts p join companies c on c.id = p.company_id";

function page(options: PageOptions): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(options.limit ?? 20, 100)),
    offset: Math.max(0, options.offset ?? 0),
  };
}

function query(
  db: Db,
  where: string,
  params: (string | number | null)[],
  options: PageOptions,
): Paged<PostCard> {
  const { limit, offset } = page(options);
  const total = (
    db.$client.prepare(`select count(*) as n ${FROM} where ${VISIBLE} ${where}`).get(...params) as {
      n: number;
    }
  ).n;
  const items = db.$client
    .prepare(`select ${CARD_COLUMNS} ${FROM} where ${VISIBLE} ${where} ${ORDER} limit ? offset ?`)
    .all(...params, limit, offset) as PostCard[];
  return { items, total };
}

export function latestPosts(db: Db, options: PageOptions = {}): Paged<PostCard> {
  return query(db, "", [], options);
}

export function postsByCompany(
  db: Db,
  companySlug: string,
  options: PageOptions = {},
): Paged<PostCard> {
  return query(db, "and c.slug = ?", [companySlug], options);
}

export function postsByTag(db: Db, tagSlug: string, options: PageOptions = {}): Paged<PostCard> {
  return query(
    db,
    `and exists (
       select 1 from post_tags pt join tags t on t.id = pt.tag_id
       where pt.post_id = p.id and t.slug = ?
     )`,
    [tagSlug],
    options,
  );
}

/**
 * 按年归档。用派生列 `published_year`（按 `sources.timezone` 取年），所以能走索引；
 * 没有发布时间的帖子不进任何年份页——这是「宁可缺失不要编造」的代价，见 §4。
 */
export function postsByYear(db: Db, year: number, options: PageOptions = {}): Paged<PostCard> {
  return query(db, "and p.published_year = ?", [year], options);
}

/** /year/[year] 的静态路径来源：只有真的有文章（且可展示）的年份才建页 */
export function postYears(db: Db): { year: number; count: number }[] {
  return db.$client
    .prepare(
      `select p.published_year as year, count(*) as count
       from posts p
       where ${VISIBLE} and p.published_year is not null
       group by p.published_year
       order by p.published_year desc`,
    )
    .all() as { year: number; count: number }[];
}

export function companyIndex(db: Db): { slug: string; name: string; count: number }[] {
  return db.$client
    .prepare(
      `select c.slug as slug, c.name as name, count(p.id) as count
       from companies c
       left join posts p on p.company_id = c.id and ${VISIBLE}
       group by c.id
       order by count(p.id) desc, c.name asc`,
    )
    .all() as { slug: string; name: string; count: number }[];
}

export function tagIndex(db: Db): { slug: string; name: string; count: number }[] {
  return db.$client
    .prepare(
      `select t.slug as slug, t.name as name, count(p.id) as count
       from tags t
       left join post_tags pt on pt.tag_id = t.id
       left join posts p on p.id = pt.post_id and ${VISIBLE}
       group by t.id
       having count(p.id) > 0
       order by count(p.id) desc, t.name asc`,
    )
    .all() as { slug: string; name: string; count: number }[];
}
