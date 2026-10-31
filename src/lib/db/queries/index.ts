import { openReadonlyDatabase } from "../index";
import type { Db } from "../index";

/**
 * Web 侧唯一的数据库入口（`guard.test.ts` 守这条边界）。
 *
 * 页面与 endpoint 只 import 这个模块，不直接碰 `src/lib/db/index`：
 * 这样「只读连接 + 可见性过滤」这些规矩集中在一处，而不是每个页面各写一遍。
 *
 * 静态构建与 SSR 搜索共用一条只读连接：SQLite 的读连接很轻，但每页都开一个
 * 会让构建期积累大量句柄；模块级缓存也保证搜索请求里 layout 与页面看到同一份数据。
 */
let webDb: Db | null = null;

export function openWebDatabase(): Db {
  webDb ??= openReadonlyDatabase();
  return webDb;
}

export * from "./posts";
export * from "./search";
