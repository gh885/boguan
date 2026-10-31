import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { checkFts } from "../../src/lib/db/fts";
import { defaultDatabasePath, openDatabase } from "../../src/lib/db/index";

/**
 * 建库 / 应用未执行的迁移。幂等，可以反复跑。
 *   vpr db:init
 *   BOGUAN_DB=data/scratch.db vpr db:init
 *
 * 只建表结构，不写数据；种子数据在 `vpr db:seed`。
 */

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const db = openDatabase();
migrate(db, { migrationsFolder });

const counts = db.$client
  .prepare(
    `select 'companies' as t, count(*) as n from companies
     union all select 'sources', count(*) from sources
     union all select 'posts', count(*) from posts
     union all select 'posts_fts', count(*) from posts_fts
     union all select 'crawl_jobs', count(*) from crawl_jobs`,
  )
  .all() as { t: string; n: number }[];

const fts = checkFts(db);

console.log(`数据库就绪：${defaultDatabasePath}`);
for (const row of counts) console.log(`  ${row.t.padEnd(11)} ${row.n}`);
if (fts.missing.length + fts.orphan.length > 0) {
  console.log(
    `  索引对账：缺 ${fts.missing.length} / 孤 ${fts.orphan.length}（vpr db:check --fix 修复）`,
  );
}
