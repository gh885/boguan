import { segment } from "@boguan/search";
import type { Db } from "./connection";

export function deletePostFts(db: Db, postId: number): void {
  db.$client.prepare("delete from posts_fts where rowid = ?").run(postId);
}

export function upsertPostFts(db: Db, postId: number, title: string, body: string): void {
  deletePostFts(db, postId);
  db.$client
    .prepare("insert into posts_fts (rowid, title_tokens, body_tokens) values (?, ?, ?)")
    .run(postId, segment(title), segment(body));
}

export interface FtsReport {
  missing: number[];
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

export function rebuildAllPostFts(db: Db, loadBody: (postId: number) => string | null): number {
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
