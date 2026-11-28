import { parseArgs } from "node:util";
import { crawl, inspect, type CrawlMode } from "./pipeline";

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
    maxPages: maxPages === 0 ? Number.POSITIVE_INFINITY : maxPages,
    only: values.source,
    force: values.force,
  });
  process.exitCode = report.inserted + report.updated === 0 && report.failed > 0 ? 1 : 0;
}
