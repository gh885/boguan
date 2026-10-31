import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vite-plus/test";
import { deleteBody, listBodyIds, pruneBodies, putBody, readBody } from "./bodies";
import { checkFts, deletePostFts, upsertPostFts } from "./fts";
import { companyIndex, latestPosts, postYears, postsByTag, postsByYear } from "./queries/posts";
import { searchPosts } from "./queries/search";
import { companies, crawlJobs, posts, sources, tagAliases, tags } from "./schema";
import type { Db } from "./index";
import { segment, toMatchQuery } from "../search/tokenize";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** 每个用例一个内存库：迁移真跑一遍，schema 与迁移文件不一致会直接失败 */
function freshDb(): Db {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

let seq = 0;

interface SeedOptions {
  company?: string;
  adapter?: string;
  title?: string;
  summary?: string;
  publishedAt?: string | null;
  publishedYear?: number | null;
  contentHash?: string;
}

function seed(db: Db, options: SeedOptions = {}) {
  const companySlug = options.company ?? `meituan-${(seq += 1)}`;
  const company = db
    .insert(companies)
    .values({ slug: companySlug, name: "美团" })
    .returning()
    .get();
  const source = db
    .insert(sources)
    .values({
      companyId: company.id,
      slug: `${companySlug}-tech`,
      name: "美团技术团队",
      adapter: options.adapter ?? "meituan-rss",
      listUrl: "https://tech.meituan.com/rss.xml",
      priority: 10,
    })
    .returning()
    .get();
  seq += 1;
  const post = db
    .insert(posts)
    .values({
      sourceId: source.id,
      companyId: company.id,
      canonicalUrl: `https://tech.meituan.com/post-${seq}.html`,
      title: options.title ?? "多级缓存架构实践",
      titleNorm: (options.title ?? "多级缓存架构实践").replace(/[^\p{L}\p{N}]+/gu, ""),
      summary: options.summary ?? "从本地缓存到分布式缓存的分层设计与一致性处理。",
      publishedAt:
        options.publishedAt === undefined ? "2024-03-01T02:00:00.000Z" : options.publishedAt,
      publishedYear: options.publishedYear === undefined ? 2024 : options.publishedYear,
      contentHash: options.contentHash ?? "hash-a",
    })
    .returning()
    .get();
  return { company, source, post };
}

describe("数据模型", () => {
  it("迁移建出表结构与 FTS5 虚拟表，且库里没有正文表", () => {
    const db = freshDb();
    const names = db.$client
      .prepare("select name from sqlite_master where type in ('table','view')")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const table of [
      "companies",
      "sources",
      "posts",
      "tags",
      "post_tags",
      "tag_aliases",
      "http_cache",
      "crawl_jobs",
      "crawl_runs",
      "crawl_failures",
      "posts_fts",
    ]) {
      expect(names, table).toContain(table);
    }
    // 正文在 crawler 私有目录里，web 用的这张库不该有承载全文的表
    expect(names).not.toContain("post_bodies");
  });

  it("canonical_url 唯一，重复写入直接失败", () => {
    const db = freshDb();
    const { post, source, company } = seed(db);
    expect(() =>
      db
        .insert(posts)
        .values({
          sourceId: source.id,
          companyId: company.id,
          canonicalUrl: post.canonicalUrl,
          title: "同一篇",
          titleNorm: "同一篇",
          contentHash: "hash-b",
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("摘要超过 200 字被 CHECK 挡住（硬性规则 1 的底线）", () => {
    const db = freshDb();
    const { source, company } = seed(db);
    expect(() =>
      db
        .insert(posts)
        .values({
          sourceId: source.id,
          companyId: company.id,
          canonicalUrl: "https://tech.meituan.com/too-long.html",
          title: "标题",
          titleNorm: "标题",
          summary: "字".repeat(201),
          contentHash: "hash-c",
        })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("duplicate_of_id 是自引用外键，胜出方被删时置空", () => {
    const db = freshDb();
    const { post, source, company } = seed(db);
    const copy = db
      .insert(posts)
      .values({
        sourceId: source.id,
        companyId: company.id,
        canonicalUrl: "https://juejin.cn/post/1",
        title: "多级缓存架构实践",
        titleNorm: "多级缓存架构实践",
        contentHash: "hash-a",
        duplicateOfId: post.id,
      })
      .returning()
      .get();
    expect(copy.duplicateOfId).toBe(post.id);

    db.delete(posts).where(eq(posts.id, post.id)).run();
    const after = db
      .select()
      .from(posts)
      .all()
      .find((row) => row.id === copy.id);
    expect(after?.duplicateOfId).toBeNull();
  });
});

describe("正文存储（crawler 私有目录）", () => {
  it("写入 → 读回 → 删除，内容是 gzip 后的文本", () => {
    const dir = mkdtempSync(join(tmpdir(), "boguan-bodies-"));
    try {
      putBody(7, "多级缓存\n的分层设计", dir);
      expect(readBody(7, dir)).toBe("多级缓存\n的分层设计");
      expect(listBodyIds(dir)).toEqual([7]);
      deleteBody(7, dir);
      expect(readBody(7, dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对账删除不在 keep 里的孤文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "boguan-bodies-"));
    try {
      putBody(1, "a", dir);
      putBody(2, "b", dir);
      putBody(3, "c", dir);
      expect(pruneBodies(new Set([1, 3]), dir)).toBe(1);
      expect(listBodyIds(dir)).toEqual([1, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FTS 同步", () => {
  it("写入、命中、原地更新与删除", () => {
    const db = freshDb();
    const { post } = seed(db);
    upsertPostFts(db, post.id, post.title, "本文介绍多级缓存的淘汰策略与一致性处理");

    const hit = (query: string) =>
      db.$client
        .prepare("select rowid as id from posts_fts where posts_fts match ?")
        .all(query)
        .map((row) => (row as { id: number }).id);

    expect(hit(toMatchQuery("缓存"))).toEqual([post.id]);
    expect(hit(toMatchQuery("降级"))).toEqual([]);

    upsertPostFts(db, post.id, post.title, "本文介绍缓存降级方案");
    expect(hit(toMatchQuery("降级"))).toEqual([post.id]);
    expect(hit(toMatchQuery("淘汰"))).toEqual([]);

    deletePostFts(db, post.id);
    expect(hit(toMatchQuery("缓存"))).toEqual([]);
  });

  it("contentless 表取不回列值：正文不可能从这里漏出去", () => {
    const db = freshDb();
    const { post } = seed(db);
    upsertPostFts(db, post.id, post.title, "正文不该被读出来");
    const row = db.$client
      .prepare("select title_tokens, body_tokens from posts_fts where rowid = ?")
      .get(post.id) as { title_tokens: unknown; body_tokens: unknown };
    expect(row.title_tokens).toBeNull();
    expect(row.body_tokens).toBeNull();
    // 也因此拿不到命中上下文：snippet/highlight 返回 NULL（§7 的取舍）
    const snippet = db.$client
      .prepare(
        "select snippet(posts_fts, 1, '[', ']', '…', 8) as s from posts_fts where posts_fts match ?",
      )
      .get(toMatchQuery("正文")) as { s: unknown };
    expect(snippet.s).toBeNull();
  });

  it("对账能报出缺失、脏残留与孤儿", () => {
    const db = freshDb();
    const { post } = seed(db);
    upsertPostFts(db, post.id, post.title, "正文");
    expect(checkFts(db)).toEqual({ missing: [], orphan: [] });

    // 下架不影响索引：可见性在查询时过滤，索引不参与判断
    db.$client.prepare("update posts set is_visible = 0 where id = ?").run(post.id);
    expect(checkFts(db)).toEqual({ missing: [], orphan: [] });

    // 帖子被删但索引还在 → orphan
    db.$client.prepare("delete from posts where id = ?").run(post.id);
    expect(checkFts(db).orphan).toEqual([post.id]);
  });
});

describe("搜索", () => {
  it("相关度优先：标题命中的排在正文命中的前面", () => {
    const db = freshDb();
    const titleHit = seed(db, { title: "缓存淘汰策略" }).post;
    const bodyHit = seed(db, { title: "监控体系建设" }).post;
    upsertPostFts(db, titleHit.id, titleHit.title, "与关键词无关的正文");
    upsertPostFts(db, bodyHit.id, bodyHit.title, "正文里提到了缓存这个词");

    const result = searchPosts(db, { q: "缓存" });
    expect(result.total).toBe(2);
    expect(result.hits.map((hit) => hit.id)).toEqual([titleHit.id, bodyHit.id]);
    expect(result.hits[0].titleHit).toBe(true);
    expect(result.hits[1].titleHit).toBe(false);
  });

  it("同分按发布时间倒序，缺时间的沉底，分页稳定", () => {
    const db = freshDb();
    const older = seed(db, { title: "缓存 A", publishedAt: "2022-01-01T00:00:00.000Z" }).post;
    const newer = seed(db, { title: "缓存 B", publishedAt: "2024-01-01T00:00:00.000Z" }).post;
    const undated = seed(db, { title: "缓存 C", publishedAt: null, publishedYear: null }).post;
    for (const post of [older, newer, undated]) upsertPostFts(db, post.id, post.title, "同质正文");

    const all = searchPosts(db, { q: "缓存" }).hits.map((hit) => hit.id);
    expect(all).toEqual([newer.id, older.id, undated.id]);

    const first = searchPosts(db, { q: "缓存", limit: 2 }).hits.map((hit) => hit.id);
    const second = searchPosts(db, { q: "缓存", limit: 2, offset: 2 }).hits.map((hit) => hit.id);
    expect([...first, ...second]).toEqual(all);
  });

  it("下架与判重输掉的条目不出现在结果里", () => {
    const db = freshDb();
    const winner = seed(db, { title: "缓存架构" }).post;
    const loser = seed(db, { title: "缓存架构（转载）" }).post;
    const hidden = seed(db, { title: "缓存缓存" }).post;
    for (const post of [winner, loser, hidden]) upsertPostFts(db, post.id, post.title, "正文");
    db.$client
      .prepare("update posts set duplicate_of_id = ? where id = ?")
      .run(winner.id, loser.id);
    db.$client.prepare("update posts set is_visible = 0 where id = ?").run(hidden.id);

    expect(searchPosts(db, { q: "缓存" }).hits.map((hit) => hit.id)).toEqual([winner.id]);
  });

  it("没有可用检索词时返回空，而不是全表", () => {
    const db = freshDb();
    const { post } = seed(db);
    upsertPostFts(db, post.id, post.title, "正文");
    expect(searchPosts(db, { q: "  " })).toEqual({ total: 0, hits: [], normalizedQuery: "" });
    expect(searchPosts(db, { q: "!!!" }).total).toBe(0);
  });

  it("公司过滤生效", () => {
    const db = freshDb();
    const a = seed(db, { company: "meituan" }).post;
    const b = seed(db, { company: "youzan" }).post;
    upsertPostFts(db, a.id, a.title, "正文");
    upsertPostFts(db, b.id, b.title, "正文");
    const result = searchPosts(db, { q: "缓存", companySlug: "youzan" });
    expect(result.hits.map((hit) => hit.id)).toEqual([b.id]);
  });
});

describe("列表查询", () => {
  it("缺时间的帖子沉底但不消失", () => {
    const db = freshDb();
    const dated = seed(db, { title: "有时间", publishedAt: "2024-01-01T00:00:00.000Z" }).post;
    const undated = seed(db, { title: "没时间", publishedAt: null, publishedYear: null }).post;
    expect(latestPosts(db).items.map((item) => item.id)).toEqual([dated.id, undated.id]);
  });

  it("年份归档按源站时区取年，缺年份的不进任何年份页", () => {
    const db = freshDb();
    // UTC 16:30 = 北京时间次日 00:30，应归到 2024
    const lateNight = seed(db, {
      title: "跨年",
      publishedAt: "2023-12-31T16:30:00.000Z",
      publishedYear: 2024,
    }).post;
    seed(db, { title: "没时间", publishedAt: null, publishedYear: null });

    expect(postYears(db)).toEqual([{ year: 2024, count: 1 }]);
    expect(postsByYear(db, 2024).items.map((item) => item.id)).toEqual([lateNight.id]);
    expect(postsByYear(db, 2023).total).toBe(0);
  });

  it("标签页与公司索引只统计可展示的帖子", () => {
    const db = freshDb();
    const { post, company } = seed(db);
    const tag = db.insert(tags).values({ slug: "cache", name: "缓存" }).returning().get();
    db.insert(tagAliases).values({ raw: "缓存", tagId: tag.id }).run();
    db.$client
      .prepare("insert into post_tags (post_id, tag_id, origin) values (?, ?, 'source')")
      .run(post.id, tag.id);

    expect(postsByTag(db, "cache").items.map((item) => item.id)).toEqual([post.id]);
    expect(companyIndex(db)).toEqual([{ slug: company.slug, name: "美团", count: 1 }]);

    db.$client.prepare("update posts set is_visible = 0 where id = ?").run(post.id);
    expect(postsByTag(db, "cache").total).toBe(0);
    expect(companyIndex(db)[0].count).toBe(0);
  });
});

describe("抓取批次", () => {
  it("run 挂在 job 上，删 job 级联删 run", () => {
    const db = freshDb();
    const job = db.insert(crawlJobs).values({ mode: "incremental" }).returning().get();
    const { source } = seed(db);
    db.$client
      .prepare("insert into crawl_runs (job_id, source_id, mode) values (?, ?, 'incremental')")
      .run(job.id, source.id);

    expect(
      db.$client.prepare("select count(*) as n from crawl_runs").get() as { n: number },
    ).toEqual({ n: 1 });
    db.$client.prepare("delete from crawl_jobs where id = ?").run(job.id);
    expect(
      db.$client.prepare("select count(*) as n from crawl_runs").get() as { n: number },
    ).toEqual({ n: 0 });
  });
});

describe("分词", () => {
  it("中文切成可命中的词，查询串给每个 token 加引号逃逸", () => {
    expect(segment("多级缓存架构实践")).toContain("缓存");
    expect(toMatchQuery("缓存 AND 淘汰")).toMatch(/^"缓存"/);
    expect(toMatchQuery('说 "引号" 呢')).not.toContain('"" 呢"');
  });
});
