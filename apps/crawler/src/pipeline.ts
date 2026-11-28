import {
  upsertPostFts,
  type Db,
  dedupe,
  openDatabase,
  companies,
  crawlFailures,
  crawlJobs,
  crawlRuns,
  postTags,
  posts,
  sources,
  tagAliases,
  tags,
} from "@boguan/database/crawler";
import {
  HIDDEN_NON_ARTICLE,
  isNonArticle,
  normalizeRawTag,
  canonicalizeUrl,
  contentHash,
  slugify,
} from "@boguan/domain";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { openBodyStore } from "@boguan/body-store";
import { adapterFor } from "./adapters";
import type { AdapterContext, SourceAdapter } from "./adapters/types";
import { PoliteFetcher } from "./fetch";
import { normalizePost, type NormalizedPost } from "./normalize";
import type { Detail } from "./types";

const bodies = openBodyStore();
import { ruleTags } from "@boguan/catalog";
import type { ListItem, TagRef } from "./types";

export type CrawlMode = "incremental" | "backfill";

export interface CrawlOptions {
  mode: CrawlMode;
  maxPages: number;
  only?: string;
  force?: boolean;
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

const WATERMARK_SLACK_MS = 6 * 60 * 60 * 1000;
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
    try {
      reports.push(await crawlSource(db, fetcher, source, options, job.id, log));
    } catch (failed) {
      const message = failed instanceof Error ? failed.message : String(failed);
      log(`[${source.slug}] 单源处理崩溃，跳过：${message}`);
      reports.push({
        slug: source.slug,
        name: source.name,
        status: "failed",
        inserted: 0,
        updated: 0,
        unchanged: 0,
        failed: 0,
        requests: 0,
        notModified: 0,
        pages: 0,
        note: message,
      });
    }
  }

  const totals = reports.reduce(
    (sum, report) => ({
      inserted: sum.inserted + report.inserted,
      updated: sum.updated + report.updated,
      failed: sum.failed + report.failed,
      requests: sum.requests + report.requests,
    }),
    { inserted: 0, updated: 0, failed: 0, requests: 0 },
  );

  const duplicates = totals.inserted + totals.updated > 0 ? dedupe(db, log) : 0;

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

function brandNames(company: typeof companies.$inferSelect | undefined): string[] {
  return [company?.name, company?.nameEn].filter((name): name is string => !!name);
}

interface KnownPost {
  id: number;
  title: string;
  summary: string;
  publishedAt: string | null;
  publishedYear: number | null;
  readingMinutes: number | null;
  hasCode: boolean | null;
  contentHash: string;
  hiddenReason: string | null;
}

function knownPosts(db: Db): Map<string, KnownPost> {
  const rows = db
    .select({
      id: posts.id,
      canonicalUrl: posts.canonicalUrl,
      title: posts.title,
      summary: posts.summary,
      publishedAt: posts.publishedAt,
      publishedYear: posts.publishedYear,
      readingMinutes: posts.readingMinutes,
      hasCode: posts.hasCode,
      contentHash: posts.contentHash,
      hiddenReason: posts.hiddenReason,
    })
    .from(posts)
    .all();
  return new Map(rows.map((row) => [row.canonicalUrl, row]));
}

function isForbiddenError(error: string): boolean {
  return /\bHTTP 403\b/.test(error);
}

function wasForbiddenLastRun(db: Db, sourceId: number, runId: number): boolean {
  const prev = db
    .select({ error: crawlRuns.error })
    .from(crawlRuns)
    .where(
      and(eq(crawlRuns.sourceId, sourceId), ne(crawlRuns.id, runId), isNotNull(crawlRuns.error)),
    )
    .orderBy(desc(crawlRuns.id))
    .get();
  return !!prev?.error && isForbiddenError(prev.error);
}

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
  let forbidden = false;
  let stopSignals = 0;
  let page = 1;
  let stopped = false;
  let error: string | null = null;
  let adapter: SourceAdapter | undefined;
  let pageLimit: number = options.maxPages;

  try {
    adapter = adapterFor(source.adapter);
    const urlOnlyList = adapter.capabilities.list === "sitemap";
    pageLimit =
      options.mode === "incremental" && urlOnlyList ? Number.POSITIVE_INFINITY : options.maxPages;
    const known = knownPosts(db);
    const tagResolver = new TagResolver(db);
    const brands = brandNames(
      db.select().from(companies).where(eq(companies.id, source.companyId)).get(),
    );

    while (page <= pageLimit && !stopped) {
      const items = await adapter.fetchList(ctx, page);
      if (items.length === 0) break;
      base.pages = page;

      const hasListTimes = items.some((item) => !!item.publishedAtRaw);
      const olderThanWatermark = (iso: string | null) =>
        !!iso && !!watermark && Date.parse(iso) <= Date.parse(watermark) - WATERMARK_SLACK_MS;
      let pageHasNew = false;

      for (const item of items) {
        const outcome = await processItem(
          {
            db,
            adapter,
            ctx,
            source,
            runId: run.id,
            brands,
            force: options.force ?? false,
            known,
            tags: tagResolver,
            unmapped,
            seen,
            log,
          },
          item,
        );
        if (!outcome) continue;
        seen.add(outcome.canonicalUrl);
        base[outcome.kind] += 1;
        if (outcome.publishedAt && (!maxSeen || outcome.publishedAt > maxSeen)) {
          maxSeen = outcome.publishedAt;
        }
        if (!olderThanWatermark(outcome.publishedAt)) pageHasNew = true;

        if (
          options.mode === "incremental" &&
          hasListTimes &&
          olderThanWatermark(outcome.publishedAt)
        ) {
          stopSignals += 1;
        } else {
          stopSignals = 0;
        }
      }

      if (options.mode === "incremental" && hasListTimes && watermark && !pageHasNew) {
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
    if (isForbiddenError(error)) forbidden = wasForbiddenLastRun(db, source.id, run.id);
    recordFailure(
      db,
      run.id,
      "list",
      adapter
        ? adapter.pageUrl(
            source.listUrl,
            pageLimit === Number.POSITIVE_INFINITY ? page : Math.min(page, pageLimit),
          )
        : source.listUrl,
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
      watermarkAt: error ? source.watermarkAt : maxSeen,
      blockedAt: denied || forbidden ? new Date().toISOString() : null,
      blockedReason: denied ? "robots" : forbidden ? "forbidden" : null,
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
    note: error ?? (denied ? "robots 拒绝" : forbidden ? "连续 403，标记 forbidden" : undefined),
  };
}

interface ItemOutcome {
  kind: "inserted" | "updated" | "unchanged";
  canonicalUrl: string;
  publishedAt: string | null;
}

interface ItemEnv {
  db: Db;
  adapter: SourceAdapter;
  ctx: AdapterContext;
  source: SourceRow;
  runId: number;
  brands: string[];
  force: boolean;
  known: Map<string, KnownPost>;
  tags: TagResolver;
  unmapped: Set<string>;
  seen: Set<string>;
  log: Log;
}

async function processItem(env: ItemEnv, item: ListItem): Promise<ItemOutcome | null> {
  const { db, adapter, ctx, source, runId, brands, force, known, tags: tagResolver } = env;
  const canonicalUrl = canonicalizeUrl(item.url, source.listUrl);
  if (!canonicalUrl) return null;
  if (env.seen.has(canonicalUrl)) return null;

  const existing = known.get(canonicalUrl) ?? null;
  const canDetail =
    adapter.capabilities.detail !== "none" && typeof adapter.fetchDetail === "function";

  const listLevel = normalizePost({
    item,
    timezone: source.timezone,
    base: source.listUrl,
    brands,
  });

  if (!listLevel && existing && !force && bodies.has(existing.id)) {
    return { kind: "unchanged", canonicalUrl, publishedAt: existing.publishedAt };
  }

  const metadataChanged =
    !listLevel ||
    !existing ||
    existing.title !== listLevel.title ||
    existing.summary !== listLevel.summary ||
    existing.publishedAt !== listLevel.publishedAt;
  const needsDetail =
    canDetail && !item.body && (metadataChanged || (!!existing && !bodies.has(existing.id)));

  if (existing && listLevel && !needsDetail && !metadataChanged && bodies.has(existing.id)) {
    db.update(posts)
      .set({
        lastSeenAt: new Date().toISOString(),
        publishedYear: existing.publishedYear ?? listLevel.publishedYear,
        readingMinutes: existing.readingMinutes ?? listLevel.readingMinutes,
        hasCode: listLevel.hasCode ?? existing.hasCode,
      })
      .where(eq(posts.id, existing.id))
      .run();
    return { kind: "unchanged", canonicalUrl, publishedAt: listLevel.publishedAt };
  }

  const fetchUrl = new URL(item.url, source.listUrl).toString();

  let normalized = listLevel;
  if (needsDetail) {
    try {
      const detail = await adapter.fetchDetail!(ctx, fetchUrl);
      normalized =
        normalizePost({ item, detail, timezone: source.timezone, base: source.listUrl, brands }) ??
        listLevel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordFailure(db, runId, "detail", canonicalUrl, null, message);
      env.log(`  [${source.slug}] 详情页失败：${canonicalUrl}（${message}）`);
    }
  }

  if (!normalized) {
    if (!needsDetail) {
      recordFailure(db, runId, "detail", canonicalUrl, null, "列表与详情页都没有标题");
      env.log(`  [${source.slug}] 拿不到标题，跳过：${canonicalUrl}`);
    }
    return null;
  }
  const post = normalized;

  const resolvedTags = tagResolver.resolve(post.tags, env.unmapped);
  const hidden = isNonArticle(
    post.title,
    resolvedTags.map((tag) => tag.slug),
  );
  const visibility = hidden
    ? { isVisible: false, hiddenReason: HIDDEN_NON_ARTICLE }
    : { isVisible: true, hiddenReason: null };

  const body = post.body || (existing ? (bodies.read(existing.id) ?? "") : "");
  const hash = contentHash(post.title, post.summary, body);
  const now = new Date().toISOString();

  if (!existing) {
    const inserted = db.$client.transaction(() => {
      const row = db
        .insert(posts)
        .values({
          sourceId: source.id,
          companyId: source.companyId,
          canonicalUrl: post.canonicalUrl,
          title: post.title,
          titleNorm: post.titleNorm,
          summary: post.summary,
          lang: source.lang,
          author: post.author,
          publishedAt: post.publishedAt,
          publishedAtRaw: post.publishedAtRaw,
          publishedYear: post.publishedYear,
          readingMinutes: post.readingMinutes,
          hasCode: post.hasCode,
          coverUrl: post.coverUrl,
          contentHash: hash,
          ...visibility,
        })
        .returning()
        .get();
      bodies.put(row.id, body);
      upsertPostFts(db, row.id, post.title, body);
      writePostTags(db, row.id, resolvedTags, post);
      return row;
    })();
    return {
      kind: "inserted",
      canonicalUrl: inserted.canonicalUrl,
      publishedAt: post.publishedAt,
    };
  }

  if (hash === existing.contentHash) {
    db.update(posts)
      .set({
        lastSeenAt: now,
        publishedAt: existing.publishedAt ?? post.publishedAt,
        publishedYear: existing.publishedYear ?? post.publishedYear,
        readingMinutes: existing.readingMinutes ?? post.readingMinutes,
        hasCode: post.hasCode ?? existing.hasCode,
      })
      .where(eq(posts.id, existing.id))
      .run();
    return { kind: "unchanged", canonicalUrl, publishedAt: post.publishedAt };
  }

  db.$client.transaction(() => {
    db.update(posts)
      .set({
        title: post.title,
        titleNorm: post.titleNorm,
        summary: post.summary,
        author: post.author,
        publishedAt: post.publishedAt,
        publishedAtRaw: post.publishedAtRaw,
        publishedYear: post.publishedYear,
        readingMinutes: post.readingMinutes ?? existing.readingMinutes,
        hasCode: post.hasCode ?? existing.hasCode,
        coverUrl: post.coverUrl,
        contentHash: hash,
        lastSeenAt: now,
        ...(existing.hiddenReason && existing.hiddenReason !== HIDDEN_NON_ARTICLE
          ? {}
          : visibility),
        duplicateOfId: null,
      })
      .where(eq(posts.id, existing.id))
      .run();

    if (body) bodies.put(existing.id, body);
    upsertPostFts(db, existing.id, post.title, body);
    writePostTags(db, existing.id, resolvedTags, post);
  })();

  return { kind: "updated", canonicalUrl: post.canonicalUrl, publishedAt: post.publishedAt };
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
          return { id: row.id, slug: row.slug, origin: "rule" as const };
        });

  db.delete(postTags)
    .where(and(eq(postTags.postId, postId), ne(postTags.origin, "manual")))
    .run();

  if (final.length === 0) return;
  db.insert(postTags)
    .values(final.map((tag) => ({ postId, tagId: tag.id, origin: tag.origin })))
    .onConflictDoNothing()
    .run();
}

interface TagRecord {
  id: number;
  slug: string;
}

interface ResolvedTag extends TagRecord {
  origin: "source" | "rule";
}

export class TagResolver {
  private aliases = new Map<string, TagRecord | null>();
  private byName = new Map<string, TagRecord>();

  constructor(private readonly db: Db) {}

  resolve(refs: TagRef[], unmapped: Set<string>): ResolvedTag[] {
    const resolved: ResolvedTag[] = [];
    const seen = new Set<number>();
    const push = (record: TagRecord) => {
      if (seen.has(record.id)) return;
      seen.add(record.id);
      resolved.push({ ...record, origin: "source" });
    };

    for (const ref of refs) {
      const raw = normalizeRawTag(ref.raw);
      if (!raw) continue;

      const alias = this.aliasFor(raw);
      if (alias) {
        push(alias);
        continue;
      }

      let known = ref.name ? this.byName.get(ref.name) : undefined;
      if (!known && ref.name) {
        known =
          this.db
            .select({ id: tags.id, slug: tags.slug })
            .from(tags)
            .where(eq(tags.name, ref.name))
            .get() ?? undefined;
        if (known) this.byName.set(ref.name, known);
      }
      if (known) {
        this.db
          .insert(tagAliases)
          .values({ raw, tagId: known.id, source: "auto" })
          .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: known.id } })
          .run();
        this.aliases.set(raw, known);
        push(known);
        continue;
      }

      const slug = slugify(ref.raw) ?? (ref.name ? slugify(ref.name) : null);
      if (!ref.name || !slug) {
        unmapped.add(raw);
        continue;
      }

      const tag = this.db
        .insert(tags)
        .values({ slug, name: ref.name })
        .onConflictDoUpdate({ target: tags.slug, set: { name: ref.name } })
        .returning()
        .get();
      this.db
        .insert(tagAliases)
        .values({ raw, tagId: tag.id, source: "auto" })
        .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: tag.id } })
        .run();
      const record = { id: tag.id, slug: tag.slug };
      this.aliases.set(raw, record);
      this.byName.set(ref.name, record);
      push(record);
    }

    return resolved;
  }

  private aliasFor(raw: string): TagRecord | null {
    const cached = this.aliases.get(raw);
    if (cached !== undefined) return cached;
    const row = this.db
      .select({ id: tags.id, slug: tags.slug })
      .from(tagAliases)
      .innerJoin(tags, eq(tags.id, tagAliases.tagId))
      .where(eq(tagAliases.raw, raw))
      .get();
    const record = row ?? null;
    this.aliases.set(raw, record);
    return record;
  }
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
    const canDetail =
      adapter.capabilities.detail !== "none" && typeof adapter.fetchDetail === "function";
    const urlOnly = items.length > 0 && !items[0]!.title;
    if (urlOnly) log("   列表只给 URL（sitemap），标题与时间取自详情页");

    let detailCalls = 0;
    const detailBudget = urlOnly ? 2 : 1;
    for (const [index, item] of items.slice(0, urlOnly ? 2 : 5).entries()) {
      let detail: Detail | undefined;
      if (canDetail && (urlOnly || index === 0) && detailCalls < detailBudget) {
        detailCalls += 1;
        try {
          detail = await adapter.fetchDetail!(ctx, item.url);
          log(
            `   详情页样例：${detail.title ? `「${detail.title}」` : ""}正文 ${detail.body?.length ?? 0} 字 / 作者 ${detail.author ?? "无"} / 时间 ${detail.publishedAtRaw ?? "无"} / 标签 ${detail.tags?.map((tag) => tag.raw).join("、") || "无"}`,
          );
        } catch (error) {
          log(
            `   ✗ 详情页失败：${item.url}（${error instanceof Error ? error.message : String(error)}）`,
          );
          continue;
        }
      }

      const normalized = normalizePost({
        item,
        detail,
        timezone: source.timezone,
        base: source.listUrl,
        brands: brandNames(company),
      });
      if (!normalized) {
        log(`   ✗ 归一失败：${item.url}`);
        continue;
      }
      log(
        `   · ${normalized.title}
     ${normalized.canonicalUrl}
     时间 ${normalized.publishedAt ?? "（解析不出来）"}（源串 ${normalized.publishedAtRaw ?? "无"}） 摘要 ${Array.from(normalized.summary).length} 字 正文 ${normalized.body.length} 字 标签 ${normalized.tags.map((tag) => tag.raw).join("/") || "无"}`,
      );
    }
    log(`   请求 ${fetcher.stats.requests} 次，robots 拦截 ${fetcher.stats.denied} 次`);
  }
}
