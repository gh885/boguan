import type { Db } from "../index";

/**
 * 列表页的只读查询（docs/ARCHITECTURE.md §6）。
 *
 * 三条共同的规矩，集中在这里实现，页面不重复写：
 * 1. 只出 `is_visible = 1 and duplicate_of_id is null` 的帖子（下架与判重输掉的不出现）；
 * 2. 排序固定 `published_at desc nulls last, id desc`——缺时间的沉底，且分页稳定；
 * 3. 只选页面要用的列，正文不在这张库里，想选也选不到。
 *
 * 卡片要的标签、阅读时长与「含代码」都是元数据，不是正文；正文仍只在 crawler 的私有目录。
 */

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
  coverUrl: string | null;
  publishedAt: string | null;
  publishedYear: number | null;
  /** 文章内容语言；在另一种语言的界面上给标题/摘要加 lang 属性 */
  lang: string;
  /** 按正文估算的阅读分钟数；没有正文或旧数据未回填时为 null */
  readingMinutes: number | null;
  /** 详情页是否含代码；列表层不知道时为 null */
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
       p.lang as lang,
       p.reading_minutes as readingMinutes,
       p.has_code as hasCode,
       c.slug as companySlug,
       c.name as companyName,
       c.name_en as companyNameEn,
       c.logo_url as companyLogoUrl`;

const FROM = "from posts p join companies c on c.id = p.company_id";

function page(options: PageOptions): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(options.limit ?? 20, 100)),
    offset: Math.max(0, options.offset ?? 0),
  };
}

function filterSql(filters: ListFilters): { where: string; params: (string | number)[] } {
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

  return {
    where: clauses.length > 0 ? `and ${clauses.join(" and ")}` : "",
    params,
  };
}

/** 一次查出当前页所有帖子的标签，避免每张卡片一个查询 */
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

export function listPosts(
  db: Db,
  filters: ListFilters = {},
  options: PageOptions = {},
): Paged<PostCard> {
  const { limit, offset } = page(options);
  const { where, params } = filterSql(filters);
  const total = (
    db.$client.prepare(`select count(*) as n ${FROM} where ${VISIBLE} ${where}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db.$client
    .prepare(`select ${CARD_COLUMNS} ${FROM} where ${VISIBLE} ${where} ${ORDER} limit ? offset ?`)
    .all(...params, limit, offset) as Omit<PostCard, "tags">[];
  return { items: attachPostTags(rows, db), total };
}

export function latestPosts(db: Db, options: PageOptions = {}): Paged<PostCard> {
  return listPosts(db, {}, options);
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

/**
 * 按年归档。用派生列 `published_year`（按 `sources.timezone` 取年），所以能走索引；
 * 没有发布时间的帖子不进任何年份页——这是「宁可缺失不要编造」的代价，见 §4。
 */
export function postsByYear(db: Db, year: number, options: PageOptions = {}): Paged<PostCard> {
  return listPosts(db, { year }, options);
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

export interface CompanyCard {
  slug: string;
  name: string;
  nameEn: string | null;
  homepage: string | null;
  logoUrl: string | null;
  count: number;
}

/** 公司页、侧边栏与 /companies 共用；accounting 只算可展示的帖子 */
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

/** 公司页的「Top Technologies」：该公司可见帖子里出现最多的标签 */
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

/** 标签页的「Companies Using This」 */
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

/** 兼容旧调用：只返回公司名 / 数量，不含 logo 与主页 */
export function companyIndex(db: Db): { slug: string; name: string; count: number }[] {
  return companyCards(db).map(({ slug, name, count }) => ({ slug, name, count }));
}
