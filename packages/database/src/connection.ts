import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "bun.lock"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function anchor(path: string): string {
  return isAbsolute(path) ? path : join(workspaceRoot(), path);
}

export const defaultDatabasePath = anchor(process.env.BOGUAN_DB ?? "data/boguan.db");

function applyPragmas(raw: Database.Database): void {
  raw.pragma("journal_mode = WAL");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("foreign_keys = ON");
}

export function openDatabase(path = defaultDatabasePath): Db {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  applyPragmas(raw);
  return drizzle(raw, { schema });
}

export function openReadonlyDatabase(path = defaultDatabasePath): Db {
  if (!existsSync(path)) {
    throw new Error(
      `数据库不存在：${path}
  本地开发：vpr db:init && vpr db:seed && vpr crawl --mode=backfill --max-pages=1
  只用构建数据：vpr db:fixture && BOGUAN_DB=data/fixture.db vpr build`,
    );
  }
  const raw = new Database(path, { readonly: true, fileMustExist: true });
  raw.pragma("busy_timeout = 5000");
  return drizzle(raw, { schema });
}
