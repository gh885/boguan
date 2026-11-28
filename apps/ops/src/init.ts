import { checkFts, defaultDatabasePath, migrateDatabase, openDatabase } from "@boguan/database/ops";

const db = openDatabase();
migrateDatabase(db);

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
