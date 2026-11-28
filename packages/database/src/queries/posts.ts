import type { Db } from "../connection";
import { editionNumber } from "@boguan/domain";

export interface PostCardTag {
  slug: string;
  name: string;
}

export interface PostCard {
  id: number;
  title: string;
  summary: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  publishedYear: number | null;
  lang: string;
  readingMinutes: number | null;
  hasCode: boolean | null;
  companySlug: string;
  companyName: string;
  companyNameEn: string | null;
  companyLogoUrl: string | null;
  tags: PostCardTag[];
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface ListFilters {
  companySlug?: string;
  tagSlug?: string;
  year?: number;
  hasCode?: boolean;
  firstSeenFrom?: string;
  firstSeenTo?: string;
}

export const VISIBLE = "p.is_visible = 1 and p.duplicate_of_id is null";
const ORDER = "order by p.published_at desc, p.id desc";

export const CARD_COLUMNS = `p.id as id,
       p.title as title,
       p.summary as summary,
       p.canonical_url as url,
       p.author as author,
       p.published_at as publishedAt,
       p.published_year as publishedYear,
       p.lang as lang,
       p.reading_minutes as readingMinutes,
       p.has_code as hasCode,
       c.slug as companySlug,
       c.name as companyName,
       c.name_en as companyNameEn,
       c.logo_url as companyLogoUrl`;

const FROM = "from posts p join companies c on c.id = p.company_id";

function fromFor(filters: ListFilters): string {
  return filters.companySlug ? FROM : "from posts p";
}

function page(options: PageOptions): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(options.limit ?? 20, 100)),
    offset: Math.max(0, options.offset ?? 0),
  };
}

export function filterSql(filters: ListFilters): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.companySlug) {
    clauses.push("c.slug = ?");
    params.push(filters.companySlug);
  }
  if (filters.tagSlug) {
    clauses.push(`exists (
       select 1 from post_tags pt join tags t on t.id = pt.tag_id
       where pt.post_id = p.id and t.slug = ?
     )`);
    params.push(filters.tagSlug);
  }
  if (filters.year !== undefined) {
    clauses.push("p.published_year = ?");
    params.push(filters.year);
  }
  if (filters.hasCode !== undefined) {
    clauses.push("p.has_code = ?");
    params.push(filters.hasCode ? 1 : 0);
  }
  if (filters.firstSeenFrom) {
    clauses.push("p.first_seen_at >= ?");
    params.push(filters.firstSeenFrom);
  }
  if (filters.firstSeenTo) {
    clauses.push("p.first_seen_at < ?");
    params.push(filters.firstSeenTo);
  }

  return {
    where: clauses.length > 0 ? `and ${clauses.join(" and ")}` : "",
    params,
  };
}

export function attachPostTags(rows: Omit<PostCard, "tags">[], db: Db): PostCard[] {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const tagRows = db.$client
    .prepare(
      `select pt.post_id as postId, t.slug as slug, t.name as name
       from post_tags pt join tags t on t.id = pt.tag_id
       where pt.post_id in (${placeholders})
       order by t.name asc`,
    )
    .all(...ids) as { postId: number; slug: string; name: string }[];

  const tagsByPost = new Map<number, PostCardTag[]>();
  for (const tag of tagRows) {
    const list = tagsByPost.get(tag.postId) ?? [];
    list.push({ slug: tag.slug, name: tag.name });
    tagsByPost.set(tag.postId, list);
  }

  return rows.map((row) => ({
    ...row,
    hasCode: row.hasCode === null ? null : Boolean(row.hasCode),
    tags: tagsByPost.get(row.id) ?? [],
  }));
}

export function countPosts(db: Db, filters: ListFilters = {}): number {
  const { where, params } = filterSql(filters);
  return (
    db.$client
      .prepare(`select count(*) as n ${fromFor(filters)} where ${VISIBLE} ${where}`)
      .get(...params) as { n: number }
  ).n;
}

export function listPosts(
  db: Db,
  filters: ListFilters = {},
  options: PageOptions = {},
): Paged<PostCard> {
  const { limit, offset } = page(options);
  const { where, params } = filterSql(filters);
  const total = countPosts(db, filters);
  const rows = db.$client
    .prepare(`select ${CARD_COLUMNS} ${FROM} where ${VISIBLE} ${where} ${ORDER} limit ? offset ?`)
    .all(...params, limit, offset) as Omit<PostCard, "tags">[];
  return { items: attachPostTags(rows, db), total };
}

export function latestPosts(db: Db, options: PageOptions = {}): Paged<PostCard> {
  return listPosts(db, {}, options);
}

export function postsByEdition(
  db: Db,
  range: { startIso: string; endIso: string },
  options: PageOptions = {},
): Paged<PostCard> {
  return listPosts(db, { firstSeenFrom: range.startIso, firstSeenTo: range.endIso }, options);
}

export interface EditionSummary {
  number: number;
  day: string;
  count: number;
}

export function editionSummaries(db: Db): EditionSummary[] {
  const rows = db.$client
    .prepare(
      `select date(p.first_seen_at, '+8 hours') as day, count(*) as count
       from posts p
       where ${VISIBLE}
       group by day
       order by day desc`,
    )
    .all() as { day: string | null; count: number }[];

  return rows.flatMap((row) => {
    const number = row.day === null ? null : editionNumber(row.day);
    return row.day !== null && number !== null && number >= 1
      ? [{ number, day: row.day, count: row.count }]
      : [];
  });
}

export function postsByCompany(
  db: Db,
  companySlug: string,
  options: PageOptions = {},
): Paged<PostCard> {
  return listPosts(db, { companySlug }, options);
}

export function postsByTag(db: Db, tagSlug: string, options: PageOptions = {}): Paged<PostCard> {
  return listPosts(db, { tagSlug }, options);
}

export function postsByYear(db: Db, year: number, options: PageOptions = {}): Paged<PostCard> {
  return listPosts(db, { year }, options);
}

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

export interface CompanyCard {
  slug: string;
  name: string;
  nameEn: string | null;
  homepage: string | null;
  logoUrl: string | null;
  count: number;
}

export function companyCards(db: Db): CompanyCard[] {
  return db.$client
    .prepare(
      `select c.slug as slug,
              c.name as name,
              c.name_en as nameEn,
              c.homepage as homepage,
              c.logo_url as logoUrl,
              count(p.id) as count
       from companies c
       left join posts p on p.company_id = c.id and ${VISIBLE}
       group by c.id
       order by count(p.id) desc, c.name asc`,
    )
    .all() as CompanyCard[];
}

export function companyBySlug(db: Db, slug: string): CompanyCard | null {
  const row = db.$client
    .prepare(
      `select c.slug as slug,
              c.name as name,
              c.name_en as nameEn,
              c.homepage as homepage,
              c.logo_url as logoUrl,
              count(p.id) as count
       from companies c
       left join posts p on p.company_id = c.id and ${VISIBLE}
       where c.slug = ?
       group by c.id`,
    )
    .get(slug) as CompanyCard | undefined;
  return row ?? null;
}

export interface TagCard {
  slug: string;
  name: string;
  count: number;
}

export function tagIndex(db: Db): TagCard[] {
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
    .all() as TagCard[];
}

export function tagBySlug(db: Db, slug: string): TagCard | null {
  const row = db.$client
    .prepare(
      `select t.slug as slug, t.name as name, count(p.id) as count
       from tags t
       left join post_tags pt on pt.tag_id = t.id
       left join posts p on p.id = pt.post_id and ${VISIBLE}
       where t.slug = ?
       group by t.id`,
    )
    .get(slug) as TagCard | undefined;
  return row ?? null;
}

export function companyTopTags(db: Db, companySlug: string, limit = 10): TagCard[] {
  return db.$client
    .prepare(
      `select t.slug as slug, t.name as name, count(p.id) as count
       from post_tags pt
       join tags t on t.id = pt.tag_id
       join posts p on p.id = pt.post_id
       join companies c on c.id = p.company_id
       where ${VISIBLE} and c.slug = ?
       group by t.id
       order by count(p.id) desc, t.name asc
       limit ?`,
    )
    .all(companySlug, limit) as TagCard[];
}

export function companiesByTag(db: Db, tagSlug: string, limit = 12): CompanyCard[] {
  return db.$client
    .prepare(
      `select c.slug as slug,
              c.name as name,
              c.name_en as nameEn,
              c.homepage as homepage,
              c.logo_url as logoUrl,
              count(p.id) as count
       from post_tags pt
       join tags t on t.id = pt.tag_id
       join posts p on p.id = pt.post_id
       join companies c on c.id = p.company_id
       where ${VISIBLE} and t.slug = ?
       group by c.id
       order by count(p.id) desc, c.name asc
       limit ?`,
    )
    .all(tagSlug, limit) as CompanyCard[];
}

export function postYearsByFilters(
  db: Db,
  filters: ListFilters = {},
): { year: number; count: number }[] {
  const { where, params } = filterSql(filters);
  return db.$client
    .prepare(
      `select p.published_year as year, count(*) as count
       ${fromFor(filters)}
       where ${VISIBLE} ${where} and p.published_year is not null
       group by p.published_year
       order by p.published_year desc`,
    )
    .all(...params) as { year: number; count: number }[];
}

export function topTags(db: Db, limit = 12): TagCard[] {
  return db.$client
    .prepare(
      `select t.slug as slug, t.name as name, count(p.id) as count
       from tags t
       join post_tags pt on pt.tag_id = t.id
       join posts p on p.id = pt.post_id
       where ${VISIBLE}
       group by t.id
       order by count(p.id) desc, t.name asc
       limit ?`,
    )
    .all(limit) as TagCard[];
}

export function topTagsByYear(db: Db, year: number, limit = 8): TagCard[] {
  return db.$client
    .prepare(
      `select t.slug as slug, t.name as name, count(p.id) as count
       from tags t
       join post_tags pt on pt.tag_id = t.id
       join posts p on p.id = pt.post_id
       where ${VISIBLE} and p.published_year = ?
       group by t.id
       order by count(p.id) desc, t.name asc
       limit ?`,
    )
    .all(year, limit) as TagCard[];
}

export function topCompaniesByYear(db: Db, year: number, limit = 6): CompanyCard[] {
  return db.$client
    .prepare(
      `select c.slug as slug,
              c.name as name,
              c.name_en as nameEn,
              c.homepage as homepage,
              c.logo_url as logoUrl,
              count(p.id) as count
       from companies c
       join posts p on p.company_id = c.id
       where ${VISIBLE} and p.published_year = ?
       group by c.id
       order by count(p.id) desc, c.name asc
       limit ?`,
    )
    .all(year, limit) as CompanyCard[];
}

export interface SiteStats {
  posts: number;
  companies: number;
  tags: number;
  years: number;
}

export function siteStats(db: Db): SiteStats {
  const row = db.$client
    .prepare(
      `select count(*) as posts,
              count(distinct p.company_id) as companies,
              count(distinct p.published_year) as years
       from posts p
       where ${VISIBLE}`,
    )
    .get() as { posts: number; companies: number; years: number };
  const tags = (
    db.$client
      .prepare(
        `select count(distinct pt.tag_id) as n
         from post_tags pt join posts p on p.id = pt.post_id
         where ${VISIBLE}`,
      )
      .get() as { n: number }
  ).n;
  return { posts: row.posts, companies: row.companies, tags, years: row.years };
}
