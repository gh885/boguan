import { eq } from "drizzle-orm";
import { listBodyIds, pruneBodies, readBody } from "../../src/lib/db/bodies";
import { checkFts, deletePostFts, upsertPostFts } from "../../src/lib/db/fts";
import { openDatabase } from "../../src/lib/db/index";
import { posts, sources } from "../../src/lib/db/schema";

/**
 * 对账与清理：
 *   vpr db:check           # 只报告，不改
 *   vpr db:check --fix     # 修复索引：补缺、删脏、删孤儿
 *   vpr db:check --prune   # 额外清理：孤正文文件、过期 http_cache / 抓取日志
 *
 * 抓取是自动流程，正常不会不一致；这个脚本用于「有人直接改过库」和「下架后的收尾」。
 */

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const fix = flags.has("--fix");
const prune = flags.has("--prune");

const db = openDatabase();
const issues: string[] = [];

const fts = checkFts(db);
console.log(`索引对账：缺失 ${fts.missing.length} / 孤儿 ${fts.orphan.length}`);

if (fix) {
  for (const id of fts.orphan) deletePostFts(db, id);
  let rebuilt = 0;
  for (const id of fts.missing) {
    const post = db.select().from(posts).where(eq(posts.id, id)).get();
    if (!post) continue;
    upsertPostFts(db, post.id, post.title, readBody(post.id) ?? "");
    rebuilt += 1;
  }
  console.log(`已修复：补写 ${rebuilt}，删除 ${fts.orphan.length}`);
} else if (fts.missing.length + fts.orphan.length > 0) {
  issues.push("索引与 posts 不一致（用 --fix 修复）");
}

/** 孤正文文件：帖子已删但仍占磁盘 */
const bodyIds = new Set(listBodyIds());
const postIds = new Set(
  (db.$client.prepare("select id from posts").all() as { id: number }[]).map((row) => row.id),
);
const orphanBodies = [...bodyIds].filter((id) => !postIds.has(id));
if (orphanBodies.length > 0) {
  if (prune) {
    const removed = pruneBodies(postIds);
    console.log(`已删除孤正文文件 ${removed} 个`);
  } else {
    issues.push(`有 ${orphanBodies.length} 个孤正文文件（用 --prune 清理）`);
  }
}
const visible = (
  db.$client
    .prepare("select count(*) as n from posts where is_visible = 1 and duplicate_of_id is null")
    .get() as { n: number }
).n;
console.log(
  `正文文件 ${bodyIds.size} 个 / 可展示帖子 ${visible} 条（差额来自正文抓取失败，下一轮会补）`,
);

/** 被挡住的源：需要人工判断，脚本不会自动解除 */
const blocked = db
  .select()
  .from(sources)
  .all()
  .filter((source) => source.blockedAt);
if (blocked.length > 0) {
  console.log(`被挡住的源 ${blocked.length} 个：`);
  for (const source of blocked) {
    console.log(`  ${source.slug}（${source.blockedReason ?? "?"}，${source.blockedAt}）`);
  }
  issues.push("有源被 robots/403 挡住，需要人工确认");
}

const lastJob = db.$client
  .prepare(
    "select id, mode, status, inserted, updated, failed, started_at as startedAt from crawl_jobs order by id desc limit 1",
  )
  .get() as
  | {
      id: number;
      mode: string;
      status: string;
      inserted: number;
      updated: number;
      failed: number;
      startedAt: string;
    }
  | undefined;
if (lastJob) {
  console.log(
    `最近批次 #${lastJob.id}：${lastJob.status}，新增 ${lastJob.inserted} / 更新 ${lastJob.updated} / 失败 ${lastJob.failed}（${lastJob.startedAt}）`,
  );
}

if (prune) {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const cache = db.$client.prepare("delete from http_cache where checked_at < ?").run(daysAgo(90));
  const failures = db.$client
    .prepare(
      "delete from crawl_failures where run_id in (select id from crawl_runs where started_at < ?)",
    )
    .run(daysAgo(90));
  const runs = db.$client.prepare("delete from crawl_runs where started_at < ?").run(daysAgo(180));
  const jobs = db.$client.prepare("delete from crawl_jobs where started_at < ?").run(daysAgo(180));
  console.log(
    `清理完成：http_cache ${cache.changes} 行 / 失败记录 ${failures.changes} 行 / 运行记录 ${runs.changes} 行 / 批次 ${jobs.changes} 行`,
  );
}

if (issues.length > 0) {
  console.log(`\n有 ${issues.length} 项需要注意：`);
  for (const issue of issues) console.log(`  - ${issue}`);
  if (!fix && !prune) process.exitCode = 1;
} else {
  console.log("\n一切正常。");
}
