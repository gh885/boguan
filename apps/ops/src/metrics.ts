import { openDatabase, posts } from "@boguan/database/ops";
import { looksLikeCode, readingMinutes } from "@boguan/domain";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { openBodyStore } from "@boguan/body-store";

const bodies = openBodyStore();

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { force: { type: "boolean", default: false } },
  strict: true,
  allowPositionals: false,
});

const db = openDatabase();
const rows = db
  .select({ id: posts.id, readingMinutes: posts.readingMinutes, hasCode: posts.hasCode })
  .from(posts)
  .all();

let updated = 0;
let skipped = 0;
let coded = 0;

const apply = db.$client.transaction(() => {
  for (const row of rows) {
    if (!values.force && row.readingMinutes !== null && row.hasCode !== null) {
      skipped += 1;
      continue;
    }
    const body = bodies.read(row.id);
    if (!body) {
      skipped += 1;
      continue;
    }

    const minutes = readingMinutes(body);
    const hasCode = looksLikeCode(body);
    if (hasCode) coded += 1;

    db.update(posts).set({ readingMinutes: minutes, hasCode }).where(eq(posts.id, row.id)).run();
    updated += 1;
  }
});
apply();

console.log(
  `阅读元数据回填完成：更新 ${updated} 篇（含代码 ${coded} 篇），跳过 ${skipped} 篇${
    values.force ? "" : "（已有值或没有正文文件；--force 可全量重算）"
  }`,
);
