import { eq } from "drizzle-orm";
import { openDatabase } from "../../src/lib/db/index";
import { readBody } from "../../src/lib/db/bodies";
import { posts } from "../../src/lib/db/schema";
import { looksLikeCode } from "../../src/lib/domain/code";
import { readingMinutes } from "../../src/lib/domain/reading";

/**
 * 从 crawler 私有的正文文件回填阅读元数据：
 *   vpr db:metrics
 *
 * 新抓取会在 normalize 里直接算好；这个脚本只处理「列刚加、旧数据还没有值」的情况。
 * `has_code` 在这里只能根据纯文本保守判断；新抓取以详情页 HTML 的 <pre>/<code> 为准。
 * 只读正文文件、只写 posts 表，不碰 FTS，也不把正文带到 web 侧。
 */

const db = openDatabase();
const rows = db.select({ id: posts.id, title: posts.title }).from(posts).all();

let updated = 0;
let skipped = 0;
let coded = 0;

for (const row of rows) {
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

console.log(
  `阅读元数据回填完成：更新 ${updated} 篇（含代码 ${coded} 篇），跳过 ${skipped} 篇（没有正文文件）`,
);
