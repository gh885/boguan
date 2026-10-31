import { openDatabase } from "../../src/lib/db/index";
import { seed } from "../crawler/sources";

/**
 * 写入公司 / 渠道 / 规则标签的种子数据。幂等：
 *   vpr db:seed
 *
 * 只 upsert「代码里有真相」的字段，人工改过的 enabled / priority / blocked_* 不会被覆盖。
 */

const db = openDatabase();
const report = seed(db);

console.log(
  `种子数据就绪：公司 ${report.companies} 个 / 渠道 ${report.sources} 个 / 规则标签 ${report.tags} 个`,
);
console.log("下一步：vpr crawl --dry-run 看解析对不对，再 vpr crawl --mode=backfill 回填历史。");
