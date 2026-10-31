import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** 数据库文件位置；生产环境用环境变量指到宿主机挂载卷 */
export const defaultDatabasePath = process.env.BOGUAN_DB ?? "data/boguan.db";

/**
 * 正文文件目录。**只有 crawler 会碰这个路径**，web 的进程从不 import 这个常量，
 * 也不需要在部署时挂载它——这是「不转载全文」的结构性保证（见 docs/ARCHITECTURE.md §4）。
 */
export const defaultBodiesDir = process.env.BOGUAN_BODIES ?? "data/bodies";

function applyPragmas(raw: Database.Database): void {
  raw.pragma("journal_mode = WAL");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("synchronous = NORMAL");
  // 级联删除依赖它，SQLite 默认是关的
  raw.pragma("foreign_keys = ON");
}

/**
 * crawler 用的读写连接。目录不存在时自动创建，省得每次部署先手动 mkdir。
 */
export function openDatabase(path = defaultDatabasePath): Db {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  applyPragmas(raw);
  return drizzle(raw, { schema });
}

/**
 * web 用的只读连接。构建期读、SSR 搜索也读，永不写。
 * 这张库里没有正文表——正文在文件里，web 拿不到。
 */
export function openReadonlyDatabase(path = defaultDatabasePath): Db {
  const raw = new Database(path, { readonly: true, fileMustExist: true });
  raw.pragma("busy_timeout = 5000");
  return drizzle(raw, { schema });
}

export { schema };
