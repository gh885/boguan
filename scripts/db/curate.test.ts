import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import type { Db } from "../../src/lib/db/index";
import * as schema from "../../src/lib/db/schema";
import { companies, posts, sources, tags, postTags } from "../../src/lib/db/schema";
import { HIDDEN_NON_ARTICLE } from "../../src/lib/domain/curate";
import { curate } from "./curate-lib";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

function freshDb(): Db {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder });

  const company = db
    .insert(companies)
    .values({ slug: "dewu", name: "得物", nameEn: "Dewu" })
    .returning()
    .get();
  const source = db
    .insert(sources)
    .values({
      companyId: company.id,
      slug: "dewu-tech",
      name: "得物技术团队",
      adapter: "dewu",
      listUrl: "https://tech.dewu.com/",
    })
    .returning()
    .get();

  const rows = [
    { title: "得物直播低延迟探索 ｜ 得物技术", summary: "摘要一", hash: "stale" },
    { title: "一次慢查的分析｜归因篇", summary: "摘要二", hash: "stale" },
    { title: "技术活动 | 有赞数据库技术开放日（已结束）", summary: "摘要三", hash: "stale" },
  ].map((row) =>
    db
      .insert(posts)
      .values({
        sourceId: source.id,
        companyId: company.id,
        canonicalUrl: `https://tech.dewu.com/article?id=${row.title.length}`,
        title: row.title,
        titleNorm: "todo",
        summary: row.summary,
        contentHash: row.hash,
        publishedAt: "2024-01-01T00:00:00.000Z",
        publishedYear: 2024,
      })
      .returning()
      .get(),
  );

  return { db, rows } as unknown as Db;
}

describe("db:curate", () => {
  it("只动命中的行：剥站点后缀、保留真副标题、下架活动页", () => {
    const { db, rows } = freshDb() as unknown as { db: Db; rows: { id: number }[] };

    const report = curate(db);
    expect(report.retitled).toBe(1);
    expect(report.hidden).toBe(1);

    const after = db.select().from(posts).all();
    // 站点后缀被剥掉
    expect(after[0]!.title).toBe("得物直播低延迟探索");
    // 真副标题原样保留
    expect(after[1]!.title).toBe("一次慢查的分析｜归因篇");
    // 活动页数据还在，只是不可见
    expect(after[2]!.title).toBe("技术活动 | 有赞数据库技术开放日（已结束）");
    expect(after[2]!.isVisible).toBe(false);
    expect(after[2]!.hiddenReason).toBe(HIDDEN_NON_ARTICLE);
    // 其它行不被误伤（这是「UPDATE 漏了 where」那次事故的回归测试）
    expect(after[0]!.isVisible).toBe(true);
    expect(after[1]!.summary).toBe("摘要二");
    expect(new Set(after.map((row) => row.title)).size).toBe(3);
    expect(rows.length).toBe(3);
  });

  it("幂等：再跑一次什么都不改", () => {
    const { db } = freshDb() as unknown as { db: Db };
    curate(db);
    const report = curate(db);
    expect(report).toEqual({
      retitled: 0,
      rehashed: 0,
      hidden: 0,
      restored: 0,
      indexed: 0,
      duplicates: 0,
    });
  });

  it("team-introduction 标签要配合标题，不误伤管理实践文章", () => {
    const { db, rows } = freshDb() as unknown as { db: Db; rows: { id: number }[] };
    const tag = db
      .insert(tags)
      .values({ slug: "team-introduction", name: "团队介绍" })
      .returning()
      .get();

    // 源站把「团队文化」类文章也打了这个标签：OKR 实践不该被下架
    db.update(posts)
      .set({ title: "透过 OKR 进行项目过程管理" })
      .where(eq(posts.id, rows[1]!.id))
      .run();
    db.insert(postTags).values({ postId: rows[1]!.id, tagId: tag.id, origin: "source" }).run();

    curate(db);
    const after = db.select().from(posts).all();
    expect(after.find((post) => post.id === rows[1]!.id)!.isVisible).toBe(true);
    // 标题确实是团队介绍的那条（tag 命中 + 标题命中）下架
    expect(after[0]!.title).toBe("得物直播低延迟探索");
  });
});
