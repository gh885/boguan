import { and, eq, ne } from "drizzle-orm";
import { hasBody, putBody, readBody } from "../../src/lib/db/bodies";
import { upsertPostFts } from "../../src/lib/db/fts";
import type { Db } from "../../src/lib/db/index";
import { openDatabase } from "../../src/lib/db/index";
import {
  companies,
  crawlFailures,
  crawlJobs,
  crawlRuns,
  postTags,
  posts,
  sources,
  tagAliases,
  tags,
} from "../../src/lib/db/schema";
import { normalizeRawTag } from "../../src/lib/domain/tag";
import { slugify } from "../../src/lib/domain/title";
import { adapterFor } from "./adapters";
import type { AdapterContext, SourceAdapter } from "./adapters/types";
import { PoliteFetcher } from "./fetch";
import { contentHash, normalizePost, type NormalizedPost } from "./normalize";
import { ruleTags } from "./rules/tags";
import type { ListItem, TagRef } from "./types";

/**
 * 抓取管道（docs/ARCHITECTURE.md §3、§5）。
 *
 * 分工：`fetch.ts` 管合规与传输，适配器管解析，这里管「什么时候停、写什么、算不算重复」。
 * 幂等是验收标准：同样的内容跑第二遍，`inserted` 与 `updated` 必须为 0。
 */

export type CrawlMode = "incremental" | "backfill";

export interface CrawlOptions {
  mode: CrawlMode;
  maxPages: number;
  only?: string;
  /** 忽略 blocked 标记，强行跑一次 */
  force?: boolean;
  /** 增量模式下连续多少条「已在水位之前」就停止翻页 */
  stopAfter?: number;
  log?: (message: string) => void;
}

export interface SourceReport {
  slug: string;
  name: string;
  status: "ok" | "partial" | "failed" | "skipped";
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  requests: number;
  notModified: number;
  pages: number;
  note?: string;
}

export interface CrawlReport {
  jobId: number;
  mode: CrawlMode;
  sources: SourceReport[];
  duplicates: number;
  inserted: number;
  updated: number;
  failed: number;
  requests: number;
}

/** 水位回看窗口：列表页顺序偶尔抖动，留一点余量再停 */
const WATERMARK_SLACK_MS = 6 * 60 * 60 * 1000;
/** 跨源去重的时间窗口：平台转载常在 1–2 天后 */
const DEDUPE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

type Log = (message: string) => void;

export async function crawl(options: CrawlOptions): Promise<CrawlReport> {
  const db = openDatabase();
  const log = options.log ?? ((message: string) => console.log(message));
  const fetcher = new PoliteFetcher(db);

  const selected = db
    .select()
    .from(sources)
    .where(eq(sources.enabled, true))
    .all()
    .filter((source) => !options.only || source.slug === options.only);

  if (selected.length === 0) {
    throw new Error(
      options.only ? `没有这个源：${options.only}` : "没有启用的源，先跑 vpr db:seed",
    );
  }

  const job = db.insert(crawlJobs).values({ mode: options.mode }).returning().get();
  log(`抓取批次 #${job.id}（${options.mode}，${selected.length} 个源）`);

  const reports: SourceReport[] = [];
  for (const source of selected) {
    reports.push(await crawlSource(db, fetcher, source, options, job.id, log));
  }

  const duplicates = dedupe(db, log);

  const totals = reports.reduce(
    (sum, report) => ({
      inserted: sum.inserted + report.inserted,
      updated: sum.updated + report.updated,
      failed: sum.failed + report.failed,
      requests: sum.requests + report.requests,
    }),
    { inserted: 0, updated: 0, failed: 0, requests: 0 },
  );

  const status = reports.every((report) => report.status === "failed")
    ? "failed"
    : reports.some((report) => report.status !== "ok")
      ? "partial"
      : "ok";

  db.update(crawlJobs)
    .set({
      finishedAt: new Date().toISOString(),
      status,
      sources: reports.length,
      requests: totals.requests,
      inserted: totals.inserted,
      updated: totals.updated,
      duplicates,
      failed: totals.failed,
    })
    .where(eq(crawlJobs.id, job.id))
    .run();

  log(
    `批次 #${job.id} 完成：新增 ${totals.inserted} / 更新 ${totals.updated} / 重复 ${duplicates} / 失败 ${totals.failed}`,
  );
  if (totals.inserted + totals.updated > 0) {
    log("数据有变化，重新构建站点即可发布：vpr build");
  }

  return { jobId: job.id, mode: options.mode, sources: reports, duplicates, ...totals };
}

type SourceRow = typeof sources.$inferSelect;

async function crawlSource(
  db: Db,
  fetcher: PoliteFetcher,
  source: SourceRow,
  options: CrawlOptions,
  jobId: number,
  log: Log,
): Promise<SourceReport> {
  const base: SourceReport = {
    slug: source.slug,
    name: source.name,
    status: "ok",
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    requests: 0,
    notModified: 0,
    pages: 0,
  };

  if (source.blockedAt && !options.force) {
    log(`跳过 ${source.slug}：${source.blockedReason ?? "blocked"}（${source.blockedAt}）`);
    return { ...base, status: "skipped", note: `blocked: ${source.blockedReason}` };
  }

  const adapter = adapterFor(source.adapter);
  const run = db
    .insert(crawlRuns)
    .values({ jobId, sourceId: source.id, mode: options.mode })
    .returning()
    .get();
  const startedAt = Date.now();
  const ctx: AdapterContext = {
    fetcher,
    log: (message) => log(`  [${source.slug}] ${message}`),
    source: { slug: source.slug, name: source.name, listUrl: source.listUrl },
  };

  fetcher.resetStats();
  const unmapped = new Set<string>();
  const seen = new Set<string>();
  let watermark = source.watermarkAt;
  let maxSeen = source.watermarkAt;
  let denied = false;
  let stopSignals = 0;
  let page = 1;
  let stopped = false;
  let error: string | null = null;

  try {
    while (page <= options.maxPages && !stopped) {
      const items = await adapter.fetchList(ctx, page);
      if (items.length === 0) break;
      base.pages = page;

      const olderThanWatermark = (iso: string | null) =>
        !!iso && !!watermark && Date.parse(iso) <= Date.parse(watermark) - WATERMARK_SLACK_MS;
      let pageHasNew = false;

      for (const item of items) {
        const outcome = await processItem(
          db,
          adapter,
          ctx,
          source,
          run.id,
          item,
          unmapped,
          seen,
          log,
        );
        if (!outcome) continue;
        seen.add(outcome.canonicalUrl);
        base[outcome.kind] += 1;
        if (outcome.publishedAt && (!maxSeen || outcome.publishedAt > maxSeen)) {
          maxSeen = outcome.publishedAt;
        }
        if (!olderThanWatermark(outcome.publishedAt)) pageHasNew = true;

        // 增量停止条件：看时间水位，不看条数（置顶、重排都不会误停）
        if (options.mode === "incremental" && olderThanWatermark(outcome.publishedAt)) {
          stopSignals += 1;
        } else {
          stopSignals = 0;
        }
      }

      // 整页都早于水位：到此为止。比「连续 N 条」更稳，也和每页条数无关——
      // 否则一页只有 5 条时，阈值 10 永远达不到，增量就会一直往前补历史。
      if (options.mode === "incremental" && watermark && !pageHasNew) {
        log(`  [${source.slug}] 第 ${page} 页全部早于水位，停止翻页`);
        stopped = true;
      }
      if (stopSignals >= (options.stopAfter ?? 10)) {
        log(`  [${source.slug}] 连续 ${stopSignals} 条早于水位，停止翻页`);
        stopped = true;
      }

      page += 1;
    }
  } catch (failed) {
    error = failed instanceof Error ? failed.message : String(failed);
    if (error.startsWith("robots:")) denied = true;
    recordFailure(
      db,
      run.id,
      "list",
      adapter.pageUrl(source.listUrl, Math.min(page, options.maxPages)),
      null,
      error,
    );
    log(`  [${source.slug}] 抓取中断：${error}`);
  }

  const status: SourceReport["status"] =
    error && base.inserted + base.updated + base.unchanged === 0
      ? "failed"
      : error || base.failed > 0
        ? "partial"
        : "ok";

  db.update(crawlRuns)
    .set({
      finishedAt: new Date().toISOString(),
      status,
      requests: fetcher.stats.requests,
      notModified: fetcher.stats.notModified,
      listed: seen.size,
      inserted: base.inserted,
      updated: base.updated,
      unchanged: base.unchanged,
      failed: base.failed,
      error,
    })
    .where(eq(crawlRuns.id, run.id))
    .run();

  db.update(sources)
    .set({
      lastRunAt: new Date().toISOString(),
      watermarkAt: maxSeen,
      blockedAt: denied ? new Date().toISOString() : null,
      blockedReason: denied ? "robots" : null,
    })
    .where(eq(sources.id, source.id))
    .run();

  if (unmapped.size > 0) {
    log(`  [${source.slug}] 未映射的源站标签（需要人工加映射）：${[...unmapped].join("、")}`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(
    `  [${source.slug}] ${status}：列 ${seen.size} / 增 ${base.inserted} / 更 ${base.updated} / 未变 ${base.unchanged} / 失败 ${base.failed}，${fetcher.stats.requests} 次请求（304 × ${fetcher.stats.notModified}），${seconds}s`,
  );

  return {
    ...base,
    status,
    requests: fetcher.stats.requests,
    notModified: fetcher.stats.notModified,
    note: error ?? (denied ? "robots 拒绝" : undefined),
  };
}

interface ItemOutcome {
  kind: "inserted" | "updated" | "unchanged";
  canonicalUrl: string;
  publishedAt: string | null;
}

/**
 * 单条处理。增量判定的关键在「能不打开详情页就不打开」：
 * 列表页的标题 + 摘要没变、正文文件也在，就直接算未变——每天省掉全站详情页的请求。
 * 代价是「正文静默改字」不会被发现，这个取舍写在 ARCHITECTURE §3。
 */
async function processItem(
  db: Db,
  adapter: SourceAdapter,
  ctx: AdapterContext,
  source: SourceRow,
  runId: number,
  item: ListItem,
  unmapped: Set<string>,
  seen: Set<string>,
  log: Log,
): Promise<ItemOutcome | null> {
  const listLevel = normalizePost({
    item,
    timezone: source.timezone,
    base: source.listUrl,
  });
  if (!listLevel) return null;
  // 同一轮里列表页可能重复给出同一条（置顶、跨页重叠），抓过就别再抓详情
  if (seen.has(listLevel.canonicalUrl)) return null;

  const existing = db
    .select()
    .from(posts)
    .where(eq(posts.canonicalUrl, listLevel.canonicalUrl))
    .get();
  const canDetail =
    adapter.capabilities.detail !== "none" && typeof adapter.fetchDetail === "function";

  const metadataChanged =
    !existing ||
    existing.title !== listLevel.title ||
    existing.summary !== listLevel.summary ||
    existing.publishedAt !== listLevel.publishedAt;
  // 能不打开详情页就不打开：列表页没给正文时，只有「新条目 / 元数据变了 / 正文文件丢了」才去
  const needsDetail =
    canDetail && !item.body && (!existing || metadataChanged || !hasBody(existing.id));

  let normalized = listLevel;
  if (needsDetail) {
    try {
      const detail = await adapter.fetchDetail!(ctx, listLevel.canonicalUrl);
      normalized =
        normalizePost({ item, detail, timezone: source.timezone, base: source.listUrl }) ??
        listLevel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordFailure(db, runId, "detail", listLevel.canonicalUrl, null, message);
      log(`  [${source.slug}] 详情页失败：${listLevel.canonicalUrl}（${message}）`);
    }
  }

  // 详情页没拿到就沿用库里已有的正文，避免把好的正文覆盖成空
  const body = normalized.body || (existing ? (readBody(existing.id) ?? "") : "");
  const hash = contentHash(normalized.title, normalized.summary, body);
  const now = new Date().toISOString();

  if (!existing) {
    const inserted = db
      .insert(posts)
      .values({
        sourceId: source.id,
        companyId: source.companyId,
        canonicalUrl: normalized.canonicalUrl,
        title: normalized.title,
        titleNorm: normalized.titleNorm,
        summary: normalized.summary,
        lang: source.lang,
        author: normalized.author,
        publishedAt: normalized.publishedAt,
        publishedAtRaw: normalized.publishedAtRaw,
        publishedYear: normalized.publishedYear,
        readingMinutes: normalized.readingMinutes,
        hasCode: normalized.hasCode,
        coverUrl: normalized.coverUrl,
        contentHash: hash,
      })
      .returning()
      .get();

    putBody(inserted.id, body);
    upsertPostFts(db, inserted.id, normalized.title, body);
    writePostTags(db, inserted.id, resolveTags(db, normalized.tags, unmapped), normalized);
    return {
      kind: "inserted",
      canonicalUrl: normalized.canonicalUrl,
      publishedAt: normalized.publishedAt,
    };
  }

  if (hash === existing.contentHash) {
    // 内容没变：只刷新 last_seen，顺手补上以前没解析出来的时间
    db.update(posts)
      .set({
        lastSeenAt: now,
        publishedAt: existing.publishedAt ?? normalized.publishedAt,
        publishedYear: existing.publishedYear ?? normalized.publishedYear,
        readingMinutes: existing.readingMinutes ?? normalized.readingMinutes,
        hasCode: normalized.hasCode ?? existing.hasCode,
      })
      .where(eq(posts.id, existing.id))
      .run();
    return {
      kind: "unchanged",
      canonicalUrl: normalized.canonicalUrl,
      publishedAt: normalized.publishedAt,
    };
  }

  db.update(posts)
    .set({
      title: normalized.title,
      titleNorm: normalized.titleNorm,
      summary: normalized.summary,
      author: normalized.author,
      publishedAt: normalized.publishedAt,
      publishedAtRaw: normalized.publishedAtRaw,
      publishedYear: normalized.publishedYear,
      readingMinutes: normalized.readingMinutes ?? existing.readingMinutes,
      hasCode: normalized.hasCode ?? existing.hasCode,
      coverUrl: normalized.coverUrl,
      contentHash: hash,
      lastSeenAt: now,
      // 内容变了，之前判重的结论可能不再成立
      duplicateOfId: null,
    })
    .where(eq(posts.id, existing.id))
    .run();

  if (body) putBody(existing.id, body);
  upsertPostFts(db, existing.id, normalized.title, body);
  writePostTags(db, existing.id, resolveTags(db, normalized.tags, unmapped), normalized);

  return {
    kind: "updated",
    canonicalUrl: normalized.canonicalUrl,
    publishedAt: normalized.publishedAt,
  };
}

interface ResolvedTag {
  id: number;
  origin: "source" | "rule";
}

/**
 * 源站标签优先，拿不到就用关键词规则。
 * 只有「能对上中文名」的源站标签才入库——对不上说明它是源站内部的拼音别名，猜不如不猜。
 */
function resolveTags(db: Db, refs: TagRef[], unmapped: Set<string>): ResolvedTag[] {
  const resolved: ResolvedTag[] = [];
  const seen = new Set<number>();

  for (const ref of refs) {
    const raw = normalizeRawTag(ref.raw);
    if (!raw) continue;

    const alias = db.select().from(tagAliases).where(eq(tagAliases.raw, raw)).get();
    if (alias) {
      if (!seen.has(alias.tagId)) {
        seen.add(alias.tagId);
        resolved.push({ id: alias.tagId, origin: "source" });
      }
      continue;
    }

    // 同一个概念在源站可能有多个 slug（big-data 与 da-shu-ju 都叫「大数据」）：
    // 规范身份是中文名，slug 取先建出来的那个，避免同一个标签开两个页面
    const byName = ref.name
      ? db.select().from(tags).where(eq(tags.name, ref.name)).get()
      : undefined;
    if (byName) {
      db.insert(tagAliases)
        .values({ raw, tagId: byName.id, source: "auto" })
        .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: byName.id } })
        .run();
      if (!seen.has(byName.id)) {
        seen.add(byName.id);
        resolved.push({ id: byName.id, origin: "source" });
      }
      continue;
    }

    const slug = slugify(ref.raw) ?? (ref.name ? slugify(ref.name) : null);
    if (!ref.name || !slug) {
      unmapped.add(raw);
      continue;
    }

    const tag = db
      .insert(tags)
      .values({ slug, name: ref.name })
      .onConflictDoUpdate({ target: tags.slug, set: { name: ref.name } })
      .returning()
      .get();
    db.insert(tagAliases)
      .values({ raw, tagId: tag.id, source: "auto" })
      .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: tag.id } })
      .run();
    if (!seen.has(tag.id)) {
      seen.add(tag.id);
      resolved.push({ id: tag.id, origin: "source" });
    }
  }

  return resolved;
}

function writePostTags(
  db: Db,
  postId: number,
  resolved: ResolvedTag[],
  normalized: NormalizedPost,
): void {
  const final: ResolvedTag[] =
    resolved.length > 0
      ? resolved
      : ruleTags(normalized.title, normalized.summary, normalized.body).map((tag) => {
          const row = db
            .insert(tags)
            .values({ slug: tag.slug, name: tag.name })
            .onConflictDoUpdate({ target: tags.slug, set: { name: tag.name } })
            .returning()
            .get();
          return { id: row.id, origin: "rule" as const };
        });

  // 人工指定的标签不动（origin = 'manual'）
  db.delete(postTags)
    .where(and(eq(postTags.postId, postId), ne(postTags.origin, "manual")))
    .run();

  if (final.length === 0) return;
  db.insert(postTags)
    .values(final.map((tag) => ({ postId, tagId: tag.id, origin: tag.origin })))
    .onConflictDoNothing()
    .run();
}

function recordFailure(
  db: Db,
  runId: number,
  stage: "list" | "detail",
  url: string,
  status: number | null,
  message: string,
): void {
  db.insert(crawlFailures)
    .values({ runId, stage, url, status, message: message.slice(0, 500) })
    .run();
}

interface DedupeRow {
  id: number;
  companyId: number;
  titleNorm: string;
  publishedAt: string | null;
  priority: number;
}

/**
 * 跨源去重：同公司 + 同归一标题 + 3 天内。
 * 官网（priority 小）胜出，输的那条打 `duplicate_of_id`、删索引与正文文件——
 * 否则搜索里会出现同一篇文章的两个入口。
 */
export function dedupe(db: Db, log: Log): number {
  const rows = db.$client
    .prepare(
      `select p.id as id, p.company_id as companyId, p.title_norm as titleNorm,
              p.published_at as publishedAt, s.priority as priority
       from posts p
       join sources s on s.id = p.source_id
       where p.duplicate_of_id is null and p.is_visible = 1
         and exists (
           select 1 from posts q
           where q.company_id = p.company_id and q.title_norm = p.title_norm and q.id <> p.id
         )
       order by p.company_id, p.title_norm, s.priority asc, coalesce(p.published_at, '') asc, p.id asc`,
    )
    .all() as DedupeRow[];

  let marked = 0;
  let index = 0;
  while (index < rows.length) {
    const group: DedupeRow[] = [];
    const key = `${rows[index].companyId}|${rows[index].titleNorm}`;
    while (index < rows.length && `${rows[index].companyId}|${rows[index].titleNorm}` === key) {
      group.push(rows[index]);
      index += 1;
    }
    if (group.length < 2) continue;

    const winner = group[0];
    for (const loser of group.slice(1)) {
      if (!withinWindow(winner.publishedAt, loser.publishedAt)) continue;
      db.update(posts).set({ duplicateOfId: winner.id }).where(eq(posts.id, loser.id)).run();
      // 索引与正文都留着：搜索/列表在查询时按 duplicate_of_id 过滤，
      // 索引不参与可见性判断，也就不存在「改判后需要补索引」这一步
      marked += 1;
    }
  }

  if (marked > 0) log(`跨源去重：${marked} 条判为重复（保留官网/高优先级那条）`);
  return marked;
}

function withinWindow(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // 时间不全就不拿时间当否决条件
  return Math.abs(Date.parse(a) - Date.parse(b)) <= DEDUPE_WINDOW_MS;
}

/**
 * 只抓一页、只打印不写库。接入新源时先跑它（`vpr crawl --dry-run --source=...`），
 * 确认标题、时间、摘要都解析对了，再让它进每日任务。
 */
export async function inspect(
  options: { only?: string; page?: number; log?: Log } = {},
): Promise<void> {
  const db = openDatabase();
  const log = options.log ?? ((message: string) => console.log(message));
  const fetcher = new PoliteFetcher(db);

  const selected = db
    .select()
    .from(sources)
    .where(eq(sources.enabled, true))
    .all()
    .filter((source) => !options.only || source.slug === options.only);

  for (const source of selected) {
    const adapter = adapterFor(source.adapter);
    const ctx: AdapterContext = {
      fetcher,
      log: (message) => log(`  [${source.slug}] ${message}`),
      source: { slug: source.slug, name: source.name, listUrl: source.listUrl },
    };
    const page = options.page ?? 1;
    const company = db.select().from(companies).where(eq(companies.id, source.companyId)).get();
    log(`\n== ${company?.name ?? "?"} / ${source.name}（adapter=${source.adapter}）`);
    log(`   robots：${(await fetcher.robotsNote(source.listUrl)) ?? "?"}`);
    const items = await adapter.fetchList(ctx, page);
    log(`   第 ${page} 页解析出 ${items.length} 条，来源 ${adapter.pageUrl(source.listUrl, page)}`);
    // 详情页选择器也要在 dry-run 里验一遍，否则「正文 0 字」看不出是对是错
    if (items.length > 0 && adapter.fetchDetail && adapter.capabilities.detail !== "none") {
      try {
        const detail = await adapter.fetchDetail(ctx, items[0].url);
        log(
          `   详情页样例：正文 ${detail.body?.length ?? 0} 字 / 作者 ${detail.author ?? "无"} / 时间 ${detail.publishedAtRaw ?? "无"} / 标签 ${detail.tags?.map((tag) => tag.raw).join("、") || "无"}`,
        );
      } catch (error) {
        log(`   ✗ 详情页失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const item of items.slice(0, 5)) {
      const normalized = normalizePost({ item, timezone: source.timezone, base: source.listUrl });
      if (!normalized) {
        log(`   ✗ 归一失败：${item.url}`);
        continue;
      }
      log(
        `   · ${normalized.title}\n     ${normalized.canonicalUrl}\n     时间 ${normalized.publishedAt ?? "（解析不出来）"}（源串 ${normalized.publishedAtRaw ?? "无"}） 摘要 ${Array.from(normalized.summary).length} 字 正文 ${normalized.body.length} 字 标签 ${normalized.tags.map((tag) => tag.raw).join("/") || "无"}`,
      );
    }
    log(`   请求 ${fetcher.stats.requests} 次，robots 拦截 ${fetcher.stats.denied} 次`);
  }
}
