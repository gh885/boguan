import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vite-plus/test";
import { upsertPostFts } from "../../src/lib/db/fts";
import type { Db } from "../../src/lib/db/index";
import * as schema from "../../src/lib/db/schema";
import { companies, posts, sources, tags } from "../../src/lib/db/schema";
import { isPostUrl } from "./adapters/youzan";
import { requirePageText, type FetchedPage } from "./fetch";
import { dedupe, TagResolver } from "./pipeline";
import { parseSitemapUrls } from "./sitemap";
import { contentHash, normalizePost } from "./normalize";
import { ruleTags } from "./rules/tags";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

function freshDb(): Db {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

const TIMEZONE = "Asia/Shanghai";

describe("normalizePost", () => {
  it("列表页缺的时间按源站时区补，标题与摘要都过归一", () => {
    const post = normalizePost({
      item: {
        url: "/2026/10/29/AI-Coding.html?utm_source=wx#top",
        title: "  如何在“不能出错”的系统里使用 AI Coding？ ",
        publishedAtRaw: "2026-10-29",
        summary: "<p>本文结合美团基础技术部在 AI 评审中的实践&hellip;</p>",
      },
      timezone: TIMEZONE,
      base: "https://tech.meituan.com/rss.xml",
    });

    expect(post?.canonicalUrl).toBe("https://tech.meituan.com/2026/10/29/AI-Coding.html");
    expect(post?.title).toBe("如何在“不能出错”的系统里使用 AI Coding？");
    expect(post?.publishedAt).toBe("2026-10-28T16:00:00.000Z");
    expect(post?.publishedYear).toBe(2026);
    expect(post?.summary).toBe("本文结合美团基础技术部在 AI 评审中的实践…");
  });

  it("没有标题或 URL 不合法时丢弃整条，而不是写半个记录", () => {
    expect(
      normalizePost({
        item: { url: "/x", title: "  " },
        timezone: TIMEZONE,
        base: "https://a.com",
      }),
    ).toBeNull();
    expect(
      normalizePost({
        item: { url: "mailto:a@b.c", title: "t" },
        timezone: TIMEZONE,
        base: "https://a.com",
      }),
    ).toBeNull();
  });

  it("详情页字段优先于列表页，正文超长会被截断", () => {
    const post = normalizePost({
      item: { url: "https://a.com/p", title: "标题", author: "列表作者", body: "列表正文" },
      detail: {
        author: "详情作者",
        body: "字".repeat(70_000),
        tags: [{ raw: "big-data", name: "大数据" }],
      },
      timezone: TIMEZONE,
      base: "https://a.com",
    });
    expect(post?.author).toBe("详情作者");
    expect(post?.body.length).toBe(60_000);
    expect(post?.tags).toEqual([{ raw: "big-data", name: "大数据" }]);
  });

  it("指纹对内容敏感：摘要变化会让 contentHash 变，供增量判定", () => {
    const a = contentHash("标题", "摘要 A", "正文");
    expect(a).toBe(contentHash("标题", "摘要 A", "正文"));
    expect(a).not.toBe(contentHash("标题", "摘要 B", "正文"));
  });
});

describe("sitemap 当列表入口", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://tech.youzan.com/web-https-engineering/</loc>
        <lastmod>2026-03-18T08:00:17.491Z</lastmod></url>
      <url><loc>https://tech.youzan.com/cut-boy/</loc></url>
      <url><loc>https://tech.youzan.com/cut-boy/</loc></url>
      <url><loc>/relative-slug/</loc></url>
      <url><loc></loc></url>
    </urlset>`;

  it("抓全部 loc、相对地址按 sitemap 地址补全、重复去掉", () => {
    expect(parseSitemapUrls(xml, "https://tech.youzan.com/sitemap-posts.xml")).toEqual([
      "https://tech.youzan.com/web-https-engineering/",
      "https://tech.youzan.com/cut-boy/",
      "https://tech.youzan.com/relative-slug/",
    ]);
  });

  it("只留单段路径的文章页，标签页 / 分页 / 子站点地图都排掉", () => {
    const urls = parseSitemapUrls(xml, "https://tech.youzan.com/sitemap-posts.xml", {
      keep: isPostUrl,
    });
    expect(urls).toHaveLength(3);

    const kept = (path: string) => isPostUrl(new URL(path, "https://tech.youzan.com"));
    expect(kept("/cut-boy/")).toBe(true);
    expect(kept("/tag/big-data/")).toBe(false);
    expect(kept("/page/2/")).toBe(false);
    expect(kept("/sitemap-pages.xml")).toBe(false);
    expect(kept("/a/b/")).toBe(false);
  });
});

describe("列表只给 URL 的源", () => {
  it("标题与时间由详情页补", () => {
    const post = normalizePost({
      item: { url: "https://tech.youzan.com/cut-boy/" },
      detail: {
        title: "  《切男孩》—— 一次图片服务重构 ",
        publishedAtRaw: "28 Oct 2022",
        body: "正文".repeat(300),
      },
      timezone: TIMEZONE,
      base: "https://tech.youzan.com/sitemap-posts.xml",
    });

    expect(post?.title).toBe("《切男孩》—— 一次图片服务重构");
    expect(post?.publishedAt).toBe("2022-10-27T16:00:00.000Z");
    expect(post?.publishedYear).toBe(2022);
    expect(post?.summary.length).toBeLessThanOrEqual(200);
  });

  it("列表与详情页都没有标题就不入库", () => {
    expect(
      normalizePost({
        item: { url: "https://tech.youzan.com/cut-boy/" },
        timezone: TIMEZONE,
        base: "https://tech.youzan.com/sitemap-posts.xml",
      }),
    ).toBeNull();
  });
});

describe("关键词打标", () => {
  it("标题命中直接算数，正文要多次出现才计入", () => {
    const tags = ruleTags("多级缓存架构实践", "介绍一下分层设计", "缓存".repeat(5));
    expect(tags.map((tag) => tag.slug)).toContain("cache");
    expect(tags.map((tag) => tag.slug)).toContain("architecture");
  });

  it("只提了一次的主题不硬塞标签", () => {
    const tags = ruleTags("团队年度总结", "今年做了不少事", "顺便提了一次缓存，然后就没有了");
    expect(tags.map((tag) => tag.slug)).not.toContain("cache");
  });

  it("最多三个，且不重复", () => {
    const title = "缓存 数据库 前端 移动端 架构 性能 安全 监控";
    const tags = ruleTags(title, "", "");
    expect(tags.length).toBe(3);
    expect(new Set(tags.map((tag) => tag.slug)).size).toBe(3);
  });
});

interface SeedArgs {
  company: string;
  source: string;
  priority: number;
  title: string;
  publishedAt: string | null;
}

function seedPost(db: Db, args: SeedArgs): number {
  const company =
    db.select().from(companies).where(eq(companies.slug, args.company)).get() ??
    db.insert(companies).values({ slug: args.company, name: args.company }).returning().get();
  const source =
    db.select().from(sources).where(eq(sources.slug, args.source)).get() ??
    db
      .insert(sources)
      .values({
        companyId: company.id,
        slug: args.source,
        name: args.source,
        adapter: "youzan",
        listUrl: "https://example.com/",
        priority: args.priority,
      })
      .returning()
      .get();
  const row = db
    .insert(posts)
    .values({
      sourceId: source.id,
      companyId: company.id,
      canonicalUrl: `https://example.com/${args.source}-${args.title.length}-${args.publishedAt ?? "null"}`,
      title: args.title,
      titleNorm: args.title.replace(/[^\p{L}\p{N}]+/gu, ""),
      summary: "摘要",
      publishedAt: args.publishedAt,
      contentHash: `hash-${args.source}`,
    })
    .returning()
    .get();
  upsertPostFts(db, row.id, row.title, "正文");
  return row.id;
}

describe("requirePageText", () => {
  const page = (overrides: Partial<FetchedPage>): FetchedPage => ({
    url: "https://a.com/",
    status: 200,
    text: "正文",
    notModified: false,
    denied: false,
    error: null,
    ...overrides,
  });

  it("200 返回正文，304 返回 null（走跳过路径，不当成错误）", () => {
    expect(requirePageText(page({}), "feed")).toBe("正文");
    expect(
      requirePageText(page({ status: 304, text: null, notModified: true }), "feed"),
    ).toBeNull();
  });

  it("其他失败抛错，错误串用 fetch 层给出的", () => {
    expect(() => requirePageText(page({ text: null, error: "HTTP 403" }), "feed")).toThrow(
      "HTTP 403",
    );
    expect(() => requirePageText(page({ text: null, error: null }), "feed")).toThrow("feed为空");
  });
});

describe("TagResolver", () => {
  it("alias 命中、按中文名建 alias、未映射收集，且 slug 一并给出", () => {
    const db = freshDb();
    const resolver = new TagResolver(db);
    db.insert(tags).values({ slug: "frontend", name: "前端" }).returning().get();

    const unmapped = new Set<string>();
    const resolved = resolver.resolve(
      [
        { raw: "前端", name: "前端" },
        { raw: "Da-Shu-Ju", name: "大数据" },
        { raw: "内部拼音别名" },
      ],
      unmapped,
    );

    expect(resolved.map((tag) => tag.slug)).toEqual(["frontend", "da-shu-ju"]);
    expect(unmapped.has("内部拼音别名")).toBe(true);
    // 大数据：先建 tag，再写 alias，第二轮直接命中且不重复建
    const second = resolver.resolve([{ raw: "大数据", name: "大数据" }], new Set());
    expect(second.map((tag) => tag.slug)).toEqual(["da-shu-ju"]);
    expect(db.select().from(tags).all()).toHaveLength(2);
  });
});

const noop = () => {};

describe("跨源去重", () => {
  it("同公司 + 同标题 + 3 天内：priority 小的胜出，输家被标记（索引保留，查询时过滤）", () => {
    const db = freshDb();
    const official = seedPost(db, {
      company: "meituan",
      source: "official",
      priority: 10,
      title: "多级缓存架构实践",
      publishedAt: "2024-03-01T02:00:00.000Z",
    });
    const repost = seedPost(db, {
      company: "meituan",
      source: "juejin",
      priority: 20,
      title: "多级缓存架构实践！",
      publishedAt: "2024-03-02T02:00:00.000Z",
    });

    expect(dedupe(db, noop)).toBe(1);
    const rows = db.select().from(posts).all();
    expect(rows.find((row) => row.id === repost)?.duplicateOfId).toBe(official);
    expect(rows.find((row) => row.id === official)?.duplicateOfId).toBeNull();

    // 索引与可见性解耦：两条都在索引里，搜索靠 duplicate_of_id 过滤，
    // 这样「胜出方被删 → 改判」时不需要补索引
    const indexed = db.$client
      .prepare("select rowid as id from posts_fts")
      .all()
      .map((row) => (row as { id: number }).id)
      .sort((a, b) => a - b);
    expect(indexed).toEqual([official, repost].sort((a, b) => a - b));
  });

  it("超过时间窗口不判重", () => {
    const db = freshDb();
    seedPost(db, {
      company: "meituan",
      source: "s1",
      priority: 10,
      title: "同名文章",
      publishedAt: "2024-03-01T00:00:00.000Z",
    });
    seedPost(db, {
      company: "meituan",
      source: "s2",
      priority: 20,
      title: "同名文章",
      publishedAt: "2024-03-20T00:00:00.000Z",
    });
    expect(dedupe(db, noop)).toBe(0);
  });

  it("不同公司不判重：同一个技术在两家公司都发是正常现象", () => {
    const db = freshDb();
    seedPost(db, {
      company: "meituan",
      source: "s1",
      priority: 10,
      title: "缓存实践",
      publishedAt: "2024-03-01T00:00:00.000Z",
    });
    seedPost(db, {
      company: "youzan",
      source: "s2",
      priority: 10,
      title: "缓存实践",
      publishedAt: "2024-03-01T00:00:00.000Z",
    });
    expect(dedupe(db, noop)).toBe(0);
  });
});
