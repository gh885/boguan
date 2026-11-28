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

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    adapter: text("adapter").notNull(),
    listUrl: text("list_url").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    lang: text("lang").notNull().default("zh-CN"),
    priority: integer("priority").notNull().default(100),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    watermarkAt: text("watermark_at"),
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
    canonicalUrl: text("canonical_url").notNull().unique(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    summary: text("summary").notNull().default(""),
    lang: text("lang").notNull().default("zh-CN"),
    author: text("author"),
    publishedAt: text("published_at"),
    publishedAtRaw: text("published_at_raw"),
    publishedYear: integer("published_year"),
    readingMinutes: integer("reading_minutes"),
    hasCode: integer("has_code", { mode: "boolean" }),
    coverUrl: text("cover_url"),
    contentHash: text("content_hash").notNull(),
    duplicateOfId: integer("duplicate_of_id").references((): AnySQLiteColumn => posts.id, {
      onDelete: "set null",
    }),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
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
    index("posts_company_title_norm_idx").on(t.companyId, t.titleNorm),
    index("posts_visible_published_idx").on(t.isVisible, t.duplicateOfId, t.publishedAt, t.id),
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
    origin: text("origin", { enum: ["source", "rule", "manual"] })
      .notNull()
      .default("rule"),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tags_tag_idx").on(t.tagId)],
);

export const tagAliases = sqliteTable("tag_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  raw: text("raw").notNull().unique(),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["auto", "manual"] })
    .notNull()
    .default("auto"),
});

export const httpCache = sqliteTable("http_cache", {
  url: text("url").primaryKey(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  checkedAt: text("checked_at").notNull().default(nowIso),
});

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
