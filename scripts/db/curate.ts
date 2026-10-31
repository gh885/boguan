import { openDatabase } from "../../src/lib/db/index";
import { curate } from "./curate-lib";

/**
 * 把清洗规则应用到**已入库**的数据。
 *
 *   vpr db:curate --dry-run   # 只看会改什么
 *   vpr db:curate             # 真正执行
 *
 * 规则在 `src/lib/domain/curate.ts`，抓取入库时用的是同一份实现；
 * 这个脚本让存量数据追上规则。幂等：第二次跑应该什么也不改。
 */

const dryRun = process.argv.includes("--dry-run");
const report = curate(openDatabase(), { dryRun, log: (message) => console.log(message) });

console.log(
  dryRun
    ? `预演：改标题 ${report.retitled} / 重算指纹 ${report.rehashed} / 下架 ${report.hidden} / 恢复 ${report.restored}（加 --dry-run 之外什么都不会写）`
    : `完成：改标题 ${report.retitled} / 重算指纹 ${report.rehashed} / 下架 ${report.hidden} / 恢复 ${report.restored} / 重建索引 ${report.indexed} / 重判重复 ${report.duplicates}`,
);
