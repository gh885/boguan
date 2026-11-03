import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
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
import { HIDDEN_NON_ARTICLE, isNonArticle } from "../../src/lib/domain/curate";
import { normalizeRawTag } from "../../src/lib/domain/tag";
import { canonicalizeUrl } from "../../src/lib/domain/url";
import { slugify } from "../../src/lib/domain/title";
import { adapterFor } from "./adapters";
import type { AdapterContext, SourceAdapter } from "./adapters/types";
import { PoliteFetcher } from "./fetch";
import { contentHash, normalizePost, type NormalizedPost } from "./normalize";
import type { Detail } from "./types";
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
  // 单源崩溃不挡批次：源与源之间互不依赖，坏一个记录一个，其余照常
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

  // 没有任何写入时，全表去重的结论不可能变，不必再扫一遍
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

/** 公司名（中英）用于剥掉标题里的站点后缀（`｜得物技术`） */
function brandNames(company: typeof companies.$inferSelect | undefined): string[] {
  return [company?.name, company?.nameEn].filter((name): name is string => !!name);
}

/** 增量判定要用的存量帖子字段。canonicalUrl 全局唯一，作 Map 键。 */
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

/** 存量帖子一次性载入：一轮抓取几千次点查换成一个全表扫描 */
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

/** fetch 层对不重试的 4xx 记 `HTTP 403` 这样的错误串 */
function isForbiddenError(error: string): boolean {
  return /\bHTTP 403\b/.test(error);
}

/** 上一轮这个源是不是也 403：连续两轮基本就是被屏蔽了 */
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

  // run 先建好：无论后面在哪一步炸（未注册的适配器、解析崩溃），crawl_runs 都不会停在 running
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
  // catch 里还要用：adapterFor 失败时是 undefined
  let adapter: SourceAdapter | undefined;
  let pageLimit: number = options.maxPages;

  try {
    adapter = adapterFor(source.adapter);
    // 「只给 URL」的列表（sitemap）切片之间不发请求，已知条目在 processItem 里就跳过了，
    // 所以增量时必须走完全部切片才能发现新文章——`--max-pages` 在那里只约束回填
    // （回填的每个新条目都要抓一次详情，才是真正要设上限的成本）。
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

      // 时间水位只在列表条目自带时间时才有意义：sitemap 这类「只给 URL」的列表
      // 没有时间也没有「新的在前」的排序保证，按水位停会漏掉排在后面的新文章。
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

        // 增量停止条件：看时间水位，不看条数（置顶、重排都不会误停）
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

      // 整页都早于水位：到此为止。比「连续 N 条」更稳，也和每页条数无关——
      // 否则一页只有 5 条时，阈值 10 永远达不到，增量就会一直往前补历史。
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
      // 部分失败的轮次不前移水位：列表后段「已看见但没入库」的条目，下轮还能被处理到
      watermarkAt: error ? source.watermarkAt : maxSeen,
      // 连续两轮 403 基本是被源站屏蔽了，标记后停止每天撞（--force 可强行跑一次）
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

/** processItem 的一轮上下文：整个源共用，逐条只传 item */
interface ItemEnv {
  db: Db;
  adapter: SourceAdapter;
  ctx: AdapterContext;
  source: SourceRow;
  runId: number;
  brands: string[];
  force: boolean;
  /** 存量帖子（canonicalUrl 键），进程内一次载入 */
  known: Map<string, KnownPost>;
  tags: TagResolver;
  unmapped: Set<string>;
  seen: Set<string>;
  log: Log;
}

/**
 * 单条处理。增量判定的关键在「能不打开详情页就不打开」：
 * 列表页的标题 + 摘要没变、正文文件也在，就直接算未变——每天省掉全站详情页的请求。
 * 代价是「正文静默改字」不会被发现，这个取舍写在 ARCHITECTURE §3。
 */
async function processItem(env: ItemEnv, item: ListItem): Promise<ItemOutcome | null> {
  const { db, adapter, ctx, source, runId, brands, force, known, tags: tagResolver } = env;
  const canonicalUrl = canonicalizeUrl(item.url, source.listUrl);
  if (!canonicalUrl) return null;
  // 同一轮里列表可能重复给出同一条（置顶、跨页重叠），处理过就别再来一次
  if (env.seen.has(canonicalUrl)) return null;

  const existing = known.get(canonicalUrl) ?? null;
  const canDetail =
    adapter.capabilities.detail !== "none" && typeof adapter.fetchDetail === "function";

  // 列表层元数据：sitemap 这类「只给 URL」的列表给不出标题，这里就是 null
  const listLevel = normalizePost({
    item,
    timezone: source.timezone,
    base: source.listUrl,
    brands,
  });

  // 只为发现新条目的列表（sitemap）：库里已有正文就一次请求都不发。
  // 这是「sitemap 当列表」能天天跑的前提——否则每天要重抓全站详情页。
  if (!listLevel && existing && !force && hasBody(existing.id)) {
    return { kind: "unchanged", canonicalUrl, publishedAt: existing.publishedAt };
  }

  const metadataChanged =
    !listLevel ||
    !existing ||
    existing.title !== listLevel.title ||
    existing.summary !== listLevel.summary ||
    existing.publishedAt !== listLevel.publishedAt;
  // 能不打开详情页就不打开：新条目 / 元数据变了 / 正文文件丢了。
  // 最后一类包含「上次详情页抓失败、按列表层入了库」的条目——不重试，正文与索引正文就永久为空。
  const needsDetail =
    canDetail && !item.body && (metadataChanged || (!!existing && !hasBody(existing.id)));

  // 元数据没变、详情也不用抓、正文文件还在：内容不可能变（正文只有 crawler 写），
  // 直接按未变处理——省掉每轮对全站正文的 gunzip + sha256
  if (existing && listLevel && !needsDetail && !metadataChanged && hasBody(existing.id)) {
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

  // 抓取用列表里给的原始地址，canonical 地址只做身份：有赞对去掉结尾斜杠的地址
  // 会 301 回来，拿 canonical 去抓等于每篇多一次请求（回填 351 篇就是双倍）
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

  // 列表与详情页都没给出标题：不是能入库的东西，记失败等人看
  if (!normalized) {
    if (!needsDetail) {
      recordFailure(db, runId, "detail", canonicalUrl, null, "列表与详情页都没有标题");
      env.log(`  [${source.slug}] 拿不到标题，跳过：${canonicalUrl}`);
    }
    return null;
  }
  const post = normalized;

  // 可见性：非文章页（活动报名、团队介绍）不入列表/搜索/sitemap，但数据保留（ARCHITECTURE §3）
  const resolvedTags = tagResolver.resolve(post.tags, env.unmapped);
  const hidden = isNonArticle(
    post.title,
    resolvedTags.map((tag) => tag.slug),
  );
  const visibility = hidden
    ? { isVisible: false, hiddenReason: HIDDEN_NON_ARTICLE }
    : { isVisible: true, hiddenReason: null };

  // 详情页没拿到就沿用库里已有的正文，避免把好的正文覆盖成空
  const body = post.body || (existing ? (readBody(existing.id) ?? "") : "");
  const hash = contentHash(post.title, post.summary, body);
  const now = new Date().toISOString();

  if (!existing) {
    // 单篇的「posts + 正文 + FTS + 标签」是一个逻辑写入，包进事务：
    // 中途崩溃不会留下 posts 有、索引缺的半态；正文文件不是事务性的，
    // 回滚最多留个孤文件，`vpr db:check --prune` 会清
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
      putBody(row.id, body);
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
    // 内容没变：只刷新 last_seen，顺手补上以前没解析出来的时间
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
        // 人工下架（原因不是 non-article）不被规则覆盖，规则只管自己那一类
        ...(existing.hiddenReason && existing.hiddenReason !== HIDDEN_NON_ARTICLE
          ? {}
          : visibility),
        // 内容变了，之前判重的结论可能不再成立
        duplicateOfId: null,
      })
      .where(eq(posts.id, existing.id))
      .run();

    if (body) putBody(existing.id, body);
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

interface TagRecord {
  id: number;
  slug: string;
}

interface ResolvedTag extends TagRecord {
  origin: "source" | "rule";
}

/**
 * 源站标签 → 规范标签的解析，带进程内缓存。
 * alias 映射基本静态，逐条 item 逐个标签点查数据库纯属浪费——一轮增量是上千次点查。
 * 缓存语义：alias 未命中（null）也是结论，resolver 自己才会写 alias，本轮内持续有效；
 * 按中文名查 tags 不缓存未命中，规则标签可能在本轮中途新建同名 tag。
 */
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

      // 同一个概念在源站可能有多个 slug（big-data 与 da-shu-ju 都叫「大数据」）：
      // 规范身份是中文名，slug 取先建出来的那个，避免同一个标签开两个页面
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
    const canDetail =
      adapter.capabilities.detail !== "none" && typeof adapter.fetchDetail === "function";
    // sitemap 这类列表只给 URL：详情页是唯一的信息来源，多抽一条
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
