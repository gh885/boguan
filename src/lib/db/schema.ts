import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * 数据模型。设计说明见 docs/ARCHITECTURE.md §4、抓取流程见 §5。
 *
 * 约定：
 * - 时间一律存 ISO 8601 UTC 字符串（`2023-05-12T03:00:00.000Z`），可直接按字典序比较。
 * - 表名 / 列名用 snake_case，字段名用 camelCase（Drizzle 显式映射，不靠自动转换）。
 * - **正文不在这份 schema 里**：它在 crawler 私有的文件目录（src/lib/db/bodies.ts），
 *   所以 web 进程即使拿到数据库连接也读不到正文。索引 `posts_fts` 是 contentless 的，
 *   列值不可读回，只有 term 与位置。
 * - 这个文件是 crawler 与 web 唯一的共享点，不放任何查询逻辑（查询在 src/lib/db/queries/）。
 */

/** 与 `strftime` 一致的当前时间，避免应用层和 SQLite 写出两种格式 */
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  homepage: text("homepage"),
  logoUrl: text("logo_url"),
  createdAt: text("created_at").notNull().default(nowIso),
});

/**
 * 一个公司可以有多个发布渠道（官网博客、掘金账号、RSS），每个渠道一行。
 *
 * 「怎么解析」只有一处真相：`adapter` 指向 `scripts/crawler/adapters/` 里的文件，
 * 列表页有没有时间、正文要不要进详情页，都由适配器的 `capabilities` 声明，不另存列。
 */
export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** 适配器 slug，对应 scripts/crawler/adapters/*.ts 导出的 adapter */
    adapter: text("adapter").notNull(),
    listUrl: text("list_url").notNull(),
    /** 源站本地时区：列表页给的是「无时区时间」时按它解释，也决定 published_year 的取年口径 */
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    /** 内容语言，默认 'zh-CN'（见 §9） */
    lang: text("lang").notNull().default("zh-CN"),
    /** 跨源去重时的胜出顺序，数字小者优先（官网 < 平台账号） */
    priority: integer("priority").notNull().default(100),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** 增量水位：已经见过的最大 published_at；停止翻页看它，不看条数 */
    watermarkAt: text("watermark_at"),
    /** 被挡住的时间：非空即需要人工看一眼，且在解除前不再抓（--force 可强行跑一次） */
    blockedAt: text("blocked_at"),
    blockedReason: text("blocked_reason", {
      enum: ["robots", "forbidden", "login-wall", "unsupported"],
    }),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => [index("sources_company_idx").on(t.companyId), index("sources_enabled_idx").on(t.enabled)],
);

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** 归一后的原文地址：去 utm/锚点、统一协议与末尾斜杠 */
    canonicalUrl: text("canonical_url").notNull().unique(),
    title: text("title").notNull(),
    /** 归一去重键（NFKC + 小写 + 只留字母数字汉字），跨源查重用 */
    titleNorm: text("title_norm").notNull(),
    /** 页面展示用摘要，硬上限 200 字（硬性规则 1），由 CHECK 兜住 */
    summary: text("summary").notNull().default(""),
    lang: text("lang").notNull().default("zh-CN"),
    author: text("author"),
    /** 解析不出来就是 NULL，不编造；缺时间的沉底展示，不进 /year 归档 */
    publishedAt: text("published_at"),
    /** 源站原始时间串，便于回溯解析规则 */
    publishedAtRaw: text("published_at_raw"),
    /** 派生列：按 sources.timezone 取的年份，/year/[year] 直接命中索引 */
    publishedYear: integer("published_year"),
    /** 按正文估算的阅读分钟数；没有正文时为 NULL。派生元数据，不是正文 */
    readingMinutes: integer("reading_minutes"),
    /** 详情页是否含代码块；列表页还没拿到正文时为 NULL（不知道就不显示） */
    hasCode: integer("has_code", { mode: "boolean" }),
    coverUrl: text("cover_url"),
    /** sha256(title + summary + 正文)，未变则不重写正文与 FTS */
    contentHash: text("content_hash").notNull(),
    /** 跨源重复时指向胜出的那条；非空即不进列表、不进索引 */
    duplicateOfId: integer("duplicate_of_id").references((): AnySQLiteColumn => posts.id, {
      onDelete: "set null",
    }),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
    /** 为什么不可见：非文章页 / 人工下架。可见时为 NULL，改判只看这一列 */
    hiddenReason: text("hidden_reason"),
    firstSeenAt: text("first_seen_at").notNull().default(nowIso),
    lastSeenAt: text("last_seen_at").notNull().default(nowIso),
  },
  (t) => [
    check("posts_summary_length", sql`length(${t.summary}) <= 200`),
    index("posts_published_idx").on(t.publishedAt),
    index("posts_year_idx").on(t.publishedYear),
    index("posts_code_idx").on(t.hasCode),
    index("posts_company_published_idx").on(t.companyId, t.publishedAt),
    index("posts_source_idx").on(t.sourceId),
    // 跨源去重的查找键：同公司 + 同归一标题（±3 天在 SQL 里用 published_at 过滤）
    index("posts_company_title_norm_idx").on(t.companyId, t.titleNorm),
    // 列表查询要同时过滤 is_visible / duplicate_of_id
    index("posts_visible_published_idx").on(t.isVisible, t.duplicateOfId, t.publishedAt),
  ],
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const postTags = sqliteTable(
  "post_tags",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    /** source: 源站自带标签归一而来；rule: 关键词规则；manual: 人工指定 */
    origin: text("origin", { enum: ["source", "rule", "manual"] })
      .notNull()
      .default("rule"),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tags_tag_idx").on(t.tagId)],
);

/** 源站标签写法五花八门（「前端优化」「前端性能」），都映射到规范标签 */
export const tagAliases = sqliteTable("tag_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 归一后的原始标签（见 src/lib/domain/tag.ts 的 normalizeRawTag） */
  raw: text("raw").notNull().unique(),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["auto", "manual"] })
    .notNull()
    .default("auto"),
});

/** 条件请求缓存：列表页与详情页都带 ETag / If-Modified-Since，304 就跳过解析 */
export const httpCache = sqliteTable("http_cache", {
  url: text("url").primaryKey(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  checkedAt: text("checked_at").notNull().default(nowIso),
});

/**
 * 一次抓取批次：跨源去重、收尾统计、要不要触发重建，都挂在批次上。
 * 单源的结果在 crawl_runs（一个 job 多个 run）。
 */
export const crawlJobs = sqliteTable("crawl_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mode: text("mode", { enum: ["incremental", "backfill"] }).notNull(),
  startedAt: text("started_at").notNull().default(nowIso),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["running", "ok", "partial", "failed"] })
    .notNull()
    .default("running"),
  sources: integer("sources").notNull().default(0),
  requests: integer("requests").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  error: text("error"),
});

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => crawlJobs.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["incremental", "backfill"] }).notNull(),
    startedAt: text("started_at").notNull().default(nowIso),
    finishedAt: text("finished_at"),
    status: text("status", { enum: ["running", "ok", "partial", "failed"] })
      .notNull()
      .default("running"),
    requests: integer("requests").notNull().default(0),
    notModified: integer("not_modified").notNull().default(0),
    listed: integer("listed").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("crawl_runs_source_idx").on(t.sourceId, t.startedAt)],
);

export const crawlFailures = sqliteTable(
  "crawl_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: ["list", "detail"] }).notNull(),
    url: text("url").notNull(),
    status: integer("status"),
    message: text("message").notNull(),
    at: text("at").notNull().default(nowIso),
  },
  (t) => [index("crawl_failures_run_idx").on(t.runId)],
);

/**
 * 检索索引（FTS5 虚拟表，在迁移里手写建表）：
 *   CREATE VIRTUAL TABLE posts_fts USING fts5(
 *     title_tokens, body_tokens, tokenize = 'unicode61', content = '', contentless_delete = 1
 *   );
 *
 * rowid 约定为 posts.id；中文经 @node-rs/jieba 切词后以空格连接写入。
 * contentless 的两个后果要记住：列值取不回来（`select body_tokens` 是 NULL），
 * 且 `snippet()` / `highlight()` 不可用——所以搜索结果只给摘要，不给命中上下文（§7）。
 * 它不在 Drizzle schema 里（Drizzle 不支持虚拟表），同步逻辑在 src/lib/db/fts.ts。
 */
