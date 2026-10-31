import { segment } from "../search/tokenize";
import type { Db } from "./index";

/**
 * posts_fts 的写入与对账。虚拟表不在 Drizzle schema 里，只能走原生 SQL。
 *
 * 同步规则：先删后插（contentless 表按 rowid 删除即可），只有 `content_hash` 变化时才调用。
 * 一致性不靠触发器，靠 `checkFts()` + `vpr db:check`：以自动流程为主，人工 SQL 改库后用它对账。
 */

export function deletePostFts(db: Db, postId: number): void {
  db.$client.prepare("delete from posts_fts where rowid = ?").run(postId);
}

/** 写入（或覆盖）一条索引；body 传纯文本，这里负责分词 */
export function upsertPostFts(db: Db, postId: number, title: string, body: string): void {
  deletePostFts(db, postId);
  db.$client
    .prepare("insert into posts_fts (rowid, title_tokens, body_tokens) values (?, ?, ?)")
    .run(postId, segment(title), segment(body));
}

/**
 * `db:check` 的报告结构。
 *
 * 不变量很简单：**每篇有正文的帖子都有一行索引**（无论是否可见、是否判重输掉）。
 * 可见性与重复在查询时过滤（`queries/*` 的 `VISIBLE`），索引不参与；
 * 否则「下架再上架」这种操作会让帖子和索引脱钩，而抓取因为内容没变不会再写索引。
 */
export interface FtsReport {
  /** 帖子在、索引不在 */
  missing: number[];
  /** 索引在、帖子没了 */
  orphan: number[];
}

export function checkFts(db: Db): FtsReport {
  const indexed = new Set(
    (db.$client.prepare("select rowid as id from posts_fts").all() as { id: number }[]).map(
      (row) => row.id,
    ),
  );
  const posts = new Set(
    (db.$client.prepare("select id from posts").all() as { id: number }[]).map((row) => row.id),
  );

  const report: FtsReport = { missing: [], orphan: [] };
  for (const id of posts) if (!indexed.has(id)) report.missing.push(id);
  for (const id of indexed) if (!posts.has(id)) report.orphan.push(id);

  report.missing.sort((a, b) => a - b);
  report.orphan.sort((a, b) => a - b);
  return report;
}

/**
 * 全量重建。换分词器 / 改分词参数后用：正文从私有文件里读（见 bodies.ts），
 * 不下数据库读，`posts_fts` 也不回读自己的列（contentless 读不回来）。
 */
export function rebuildAllPostFts(db: Db, loadBody: (postId: number) => string | null): number {
  // 全量重建也遵守同一条不变量：所有帖子都进索引，可见性交给查询
  const rows = db.$client.prepare("select id, title from posts").all() as {
    id: number;
    title: string;
  }[];

  const run = db.$client.transaction(() => {
    db.$client.prepare("delete from posts_fts").run();
    for (const row of rows) {
      const body = loadBody(row.id) ?? "";
      db.$client
        .prepare("insert into posts_fts (rowid, title_tokens, body_tokens) values (?, ?, ?)")
        .run(row.id, segment(row.title), segment(body));
    }
    return rows.length;
  });

  return run();
}
