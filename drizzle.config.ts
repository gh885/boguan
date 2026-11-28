import { defineConfig } from "drizzle-kit";
import { defaultDatabasePath } from "@boguan/database/ops";

/**
 * 迁移文件的生成配置。日常用法：
 *   vp run db:generate    # schema.ts 改动后生成 SQL
 *   vp run db:init        # 建库 / 应用未执行的迁移
 *
 * 注意：FTS5 虚拟表 Drizzle 生成不了，是手写迁移（drizzle/0001_*）。
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/drizzle",
  dbCredentials: { url: defaultDatabasePath },
  strict: true,
  verbose: true,
});
