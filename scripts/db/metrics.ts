import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { openDatabase } from "../../src/lib/db/index";
import { readBody } from "../../src/lib/db/bodies";
import { posts } from "../../src/lib/db/schema";
import { looksLikeCode } from "../../src/lib/domain/code";
import { readingMinutes } from "../../src/lib/domain/reading";

/**
 * 从 crawler 私有的正文文件回填阅读元数据：
 *   vpr db:metrics              # 只补「还没有值」的行
 *   vpr db:metrics --force      # 全量重算（覆盖抓取时按 HTML 判出的 has_code）
 *
 * 新抓取会在 normalize 里直接算好；这个脚本只处理「列刚加、旧数据还没有值」的情况。
 * `has_code` 在这里只能根据纯文本保守判断，抓取时以详情页 HTML 的 <pre>/<code> 为准
 * 更可靠——所以默认不覆盖已有值，确要重算时用 --force。
 * 只读正文文件、只写 posts 表，不碰 FTS，也不把正文带到 web 侧。
 */

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
    // 已有值的行默认跳过：文本启发式不会比抓取时的 HTML 判定更准
    if (!values.force && row.readingMinutes !== null && row.hasCode !== null) {
      skipped += 1;
      continue;
    }
    const body = readBody(row.id);
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
