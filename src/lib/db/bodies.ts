import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { defaultBodiesDir } from "./index";

/**
 * 正文存储：`data/bodies/<post_id>.txt.gz`。
 *
 * 为什么不放数据库（docs/ARCHITECTURE.md §4）：把正文放进同一个 SQLite 文件，就只剩
 * 「查询层不去 select 它」这一条约定。放到 crawler 私有目录后，web 进程连文件路径都没有，
 * 硬性规则 1 变成结构性的，而不是靠自觉。
 *
 * 正文是**派生数据**：最坏情况下能从源站重抓，所以它不进事务、不参与迁移，
 * 崩溃时最多留下孤文件，由 `vpr db:check --prune` 清掉。
 */

export function bodiesDir(dir = defaultBodiesDir): string {
  return dir;
}

function fileOf(postId: number, dir: string): string {
  return join(dir, `${postId}.txt.gz`);
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 写入（覆盖）。先写临时文件再 rename，避免进程中途挂掉留下半个 gzip */
export function putBody(postId: number, text: string, dir = defaultBodiesDir): void {
  ensureDir(dir);
  const target = fileOf(postId, dir);
  const temp = `${target}.tmp`;
  writeFileSync(temp, gzipSync(Buffer.from(text, "utf8"), { level: 6 }));
  renameSync(temp, target);
}

export function readBody(postId: number, dir = defaultBodiesDir): string | null {
  const target = fileOf(postId, dir);
  if (!existsSync(target)) return null;
  try {
    return gunzipSync(readFileSync(target)).toString("utf8");
  } catch {
    // 文件损坏当作没有：crawler 下一轮会重写
    return null;
  }
}

export function hasBody(postId: number, dir = defaultBodiesDir): boolean {
  return existsSync(fileOf(postId, dir));
}

export function deleteBody(postId: number, dir = defaultBodiesDir): void {
  rmSync(fileOf(postId, dir), { force: true });
}

/** 目录里现存的正文 id，用于对账 */
export function listBodyIds(dir = defaultBodiesDir): number[] {
  if (!existsSync(dir)) return [];
  const ids: number[] = [];
  for (const name of readdirSync(dir)) {
    const match = name.match(/^(\d+)\.txt\.gz$/);
    if (!match) continue;
    ids.push(Number(match[1]));
  }
  return ids.sort((a, b) => a - b);
}

/** 删除不在 `keep` 里的正文文件（帖子被删 / 下架后调用），返回删除数量 */
export function pruneBodies(keep: ReadonlySet<number>, dir = defaultBodiesDir): number {
  let removed = 0;
  for (const id of listBodyIds(dir)) {
    if (keep.has(id)) continue;
    deleteBody(id, dir);
    removed += 1;
  }
  return removed;
}
