import { crawl, inspect, type CrawlMode } from "./pipeline";

/**
 * 抓取命令行。
 *
 *   vpr crawl                                  # 增量（默认最多翻 5 页）
 *   vpr crawl --mode=backfill --max-pages=20   # 首次接入：回填最近 20 页
 *   vpr crawl --max-pages=0                    # 翻到底（翻页仍受水位与空页限制）
 *   vpr crawl --source=youzan-tech             # 只跑一个源
 *   vpr crawl --dry-run                        # 只抓一页、只打印，不写库
 *   vpr crawl --force                          # 忽略 blocked 标记跑一次
 */

interface Flags {
  mode: CrawlMode;
  maxPages: number;
  only?: string;
  force: boolean;
  dryRun: boolean;
  page: number;
}

function parse(argv: string[]): Flags {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=", 2);
    if (value === undefined) switches.add(key);
    else values.set(key, value);
  }

  const mode: CrawlMode = values.get("mode") === "backfill" ? "backfill" : "incremental";
  const rawPages = values.get("max-pages");
  const maxPages = rawPages === undefined ? (mode === "backfill" ? 20 : 5) : Number(rawPages);
  if (Number.isNaN(maxPages) || maxPages < 0)
    throw new Error("--max-pages 需要非负整数（0 = 翻到底）");

  return {
    mode,
    // 0 表示不设上限；增量模式仍会被水位提前叫停
    maxPages: maxPages === 0 ? Number.POSITIVE_INFINITY : maxPages,
    only: values.get("source"),
    force: switches.has("force"),
    dryRun: switches.has("dry-run"),
    page: Number(values.get("page") ?? 1),
  };
}

const flags = parse(process.argv.slice(2));

if (flags.dryRun) {
  await inspect({ only: flags.only, page: flags.page });
} else {
  const report = await crawl({
    mode: flags.mode,
    maxPages: flags.maxPages,
    only: flags.only,
    force: flags.force,
  });
  // 完全没抓到东西才算失败；部分失败由 crawl_jobs.status 记录，不挡住后续重建
  process.exitCode = report.inserted + report.updated === 0 && report.failed > 0 ? 1 : 0;
}
