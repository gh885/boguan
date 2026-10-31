import { openReadonlyDatabase } from "../index";

/**
 * Web 侧唯一的数据库入口（`guard.test.ts` 守这条边界）。
 *
 * 页面与 endpoint 只 import 这个模块，不直接碰 `src/lib/db/index`：
 * 这样「只读连接 + 可见性过滤」这些规矩集中在一处，而不是每个页面各写一遍。
 */
export function openWebDatabase() {
  return openReadonlyDatabase();
}

export * from "./posts";
export * from "./search";
