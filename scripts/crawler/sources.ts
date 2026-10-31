import { eq } from "drizzle-orm";
import type { Db } from "../../src/lib/db/index";
import { companies, sources, tagAliases, tags } from "../../src/lib/db/schema";
import { allRuleTags } from "./rules/tags";

/**
 * 种子数据：公司与渠道（docs/ARCHITECTURE.md §4）。
 *
 * 这里只放「人工确认过」的源。能不能抓、抓得对不对，在 `docs/SOURCES.md` 记结论——
 * 没验证过的源不要进这张表：`enabled = true` 意味着每天都会被请求。
 */

export interface SeedCompany {
  slug: string;
  name: string;
  nameEn?: string;
  homepage?: string;
}

export interface SeedSource {
  companySlug: string;
  slug: string;
  name: string;
  adapter: string;
  listUrl: string;
  timezone?: string;
  lang?: string;
  /** 跨源去重时的胜出顺序，数字小者优先 */
  priority?: number;
}

export const SEED_COMPANIES: SeedCompany[] = [
  { slug: "meituan", name: "美团", nameEn: "Meituan", homepage: "https://tech.meituan.com/" },
  { slug: "youzan", name: "有赞", nameEn: "Youzan", homepage: "https://tech.youzan.com/" },
  { slug: "dewu", name: "得物", nameEn: "Dewu", homepage: "https://tech.dewu.com/" },
];

/**
 * 人工确认的标签别名：源站用了另一种写法，但指的是同一个概念。
 * 自动流程只按「原始写法」和「中文名」对齐，英语写法对不上中文名时只能人工补一条。
 */
export const SEED_TAG_ALIASES: { raw: string; slug: string }[] = [
  { raw: "bigdata", slug: "big-data" }, // 有赞的 tag 云里 bigdata 与 big-data 并存
  { raw: "big data", slug: "big-data" },
  // 得物的分类是中文名，映射到已有标签，跨公司才能聚合（大前端/前端 → frontend）
  { raw: "大前端", slug: "frontend" },
  { raw: "测试", slug: "testing" },
  { raw: "java", slug: "java" },
  { raw: "golang", slug: "golang" },
  { raw: "ai&数据", slug: "ai" },
  { raw: "运维&稳定生产", slug: "reliability" },
  { raw: "技术思考", slug: "engineering" },
  { raw: "音视频", slug: "media" },
];

export const SEED_SOURCES: SeedSource[] = [
  {
    companySlug: "meituan",
    slug: "meituan-tech-rss",
    name: "美团技术团队",
    adapter: "meituan-rss",
    listUrl: "https://tech.meituan.com/rss.xml",
    priority: 10,
  },
  {
    companySlug: "youzan",
    slug: "youzan-tech",
    name: "有赞技术团队",
    adapter: "youzan",
    // 有赞用 sitemap 当列表入口：一次请求就是全量文章 URL（见 docs/SOURCES.md）
    listUrl: "https://tech.youzan.com/sitemap-posts.xml",
    priority: 20,
  },
  {
    companySlug: "dewu",
    slug: "dewu-tech",
    name: "得物技术团队",
    adapter: "dewu",
    listUrl: "https://tech.dewu.com/",
    priority: 30,
  },
];

export interface SeedReport {
  companies: number;
  sources: number;
  tags: number;
}

/**
 * 幂等写入：按 slug upsert。
 * 只更新「代码里才有真相」的字段（adapter / listUrl），不动 `enabled` / `priority` /
 * `blocked_*`——那些是人工判断的结果，重新 seed 不该把它们冲掉。
 */
export function seed(db: Db): SeedReport {
  const companyIdBySlug = new Map<string, number>();

  for (const company of SEED_COMPANIES) {
    const row = db
      .insert(companies)
      .values({
        slug: company.slug,
        name: company.name,
        nameEn: company.nameEn ?? null,
        homepage: company.homepage ?? null,
      })
      .onConflictDoUpdate({
        target: companies.slug,
        set: { name: company.name, nameEn: company.nameEn ?? null },
      })
      .returning()
      .get();
    companyIdBySlug.set(company.slug, row.id);
  }

  for (const source of SEED_SOURCES) {
    const companyId = companyIdBySlug.get(source.companySlug);
    if (!companyId) throw new Error(`源 ${source.slug} 指向了不存在的公司 ${source.companySlug}`);
    db.insert(sources)
      .values({
        companyId,
        slug: source.slug,
        name: source.name,
        adapter: source.adapter,
        listUrl: source.listUrl,
        timezone: source.timezone ?? "Asia/Shanghai",
        lang: source.lang ?? "zh-CN",
        priority: source.priority ?? 100,
      })
      .onConflictDoUpdate({
        target: sources.slug,
        set: {
          name: source.name,
          adapter: source.adapter,
          listUrl: source.listUrl,
        },
      })
      .run();
  }

  // 规则标签先建好，抓取时只插 post_tags
  for (const tag of allRuleTags()) {
    db.insert(tags)
      .values({ slug: tag.slug, name: tag.name })
      .onConflictDoUpdate({ target: tags.slug, set: { name: tag.name } })
      .run();
  }

  for (const alias of SEED_TAG_ALIASES) {
    const tag = db.select().from(tags).where(eq(tags.slug, alias.slug)).get();
    if (!tag) continue;
    db.insert(tagAliases)
      .values({ raw: alias.raw, tagId: tag.id, source: "manual" })
      .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: tag.id, source: "manual" } })
      .run();
  }

  return {
    companies: SEED_COMPANIES.length,
    sources: SEED_SOURCES.length,
    tags: allRuleTags().length,
  };
}

/** 便于脚本确认 seed 后的状态（不参与抓取） */
export function seedSummary(db: Db): { sources: { slug: string; adapter: string }[] } {
  return {
    sources: db
      .select()
      .from(sources)
      .where(eq(sources.enabled, true))
      .all()
      .map((row) => ({ slug: row.slug, adapter: row.adapter })),
  };
}
