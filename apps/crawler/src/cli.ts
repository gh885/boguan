import { parseArgs } from "node:util";
import { crawl, inspect, type CrawlMode } from "./pipeline";

/**
 * 抓取命令行。参数解析用 Node 内置的 `parseArgs`：类型、默认值、未知参数报错都是标准库做的，
 * 不用为 5 个 flag 手写一遍。
 *
 *   vpr crawl                                  # 增量（默认最多翻 5 页）
 *   vpr crawl --mode=backfill --max-pages=20   # 首次接入：回填最近 20 页
 *   vpr crawl --max-pages=0                    # 翻到底（翻页仍受水位与空页限制）
 *   vpr crawl --source=youzan-tech             # 只跑一个源
 *   vpr crawl --dry-run                        # 只抓一页、只打印，不写库
 *   vpr crawl --force                          # 忽略 blocked 标记跑一次
 *
 * `--max-pages` 对「只给 URL」的列表（sitemap）在增量模式下不生效：切片之间不发请求，
 * 必须走完全部切片才能发现排在后段的新文章；那里它只约束回填。
 */

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string", default: "incremental" },
    "max-pages": { type: "string" },
    source: { type: "string" },
    page: { type: "string", default: "1" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

const mode = values.mode;
if (mode !== "incremental" && mode !== "backfill") {
  throw new Error(`--mode 只接受 incremental / backfill，收到：${String(mode)}`);
}

const defaultPages = mode === "backfill" ? 20 : 5;
const rawMaxPages = values["max-pages"];
const maxPages = rawMaxPages === undefined ? defaultPages : Number(rawMaxPages);
if (!Number.isInteger(maxPages) || maxPages < 0) {
  throw new Error("--max-pages 需要非负整数（0 = 翻到底）");
}

const page = Number(values.page);
if (!Number.isInteger(page) || page < 1) {
  throw new Error("--page 需要正整数");
}

if (values["dry-run"]) {
  await inspect({ only: values.source, page });
} else {
  const report = await crawl({
    mode: mode satisfies CrawlMode,
    // 0 表示不设上限；增量模式仍会被水位提前叫停
    maxPages: maxPages === 0 ? Number.POSITIVE_INFINITY : maxPages,
    only: values.source,
    force: values.force,
  });
  // 完全没抓到东西才算失败；部分失败由 crawl_jobs.status 记录，不挡住后续重建
  process.exitCode = report.inserted + report.updated === 0 && report.failed > 0 ? 1 : 0;
}
