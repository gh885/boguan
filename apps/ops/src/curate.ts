import { openDatabase } from "@boguan/database/ops";
import { curate } from "./curate-lib";

const dryRun = process.argv.includes("--dry-run");
const report = curate(openDatabase(), { dryRun, log: (message) => console.log(message) });

console.log(
  dryRun
    ? `预演：改标题 ${report.retitled} / 重算指纹 ${report.rehashed} / 下架 ${report.hidden} / 恢复 ${report.restored}（加 --dry-run 之外什么都不会写）`
    : `完成：改标题 ${report.retitled} / 重算指纹 ${report.rehashed} / 下架 ${report.hidden} / 恢复 ${report.restored} / 重建索引 ${report.indexed} / 重判重复 ${report.duplicates}`,
);
