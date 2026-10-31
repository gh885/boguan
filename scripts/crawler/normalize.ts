import { createHash } from "node:crypto";
import { canonicalizeUrl } from "../../src/lib/domain/url";
import { parsePublishedAt, yearInTimeZone } from "../../src/lib/domain/date";
import { decodeEntities, stripHtml, truncateSummary } from "../../src/lib/domain/text";
import { stripSiteSuffix } from "../../src/lib/domain/curate";
import { readingMinutes } from "../../src/lib/domain/reading";
import { titleNorm } from "../../src/lib/domain/title";
import type { Detail, ListItem, TagRef } from "./types";

/**
 * 归一（docs/ARCHITECTURE.md §5）：canonical URL、时间、摘要、正文、指纹。
 *
 * 这里只做纯计算，不碰数据库也不发请求——所以能被单测覆盖，也能被离线重算使用。
 */

/**
 * 正文入库/入索引的长度上限。技术长文极少超过 6 万字，
 * 而单篇 1MB 的页面会把索引和存储拖成坏账，超出部分截断。
 */
export const MAX_BODY_CHARS = 60_000;

export interface NormalizedPost {
  canonicalUrl: string;
  title: string;
  titleNorm: string;
  summary: string;
  author: string | null;
  coverUrl: string | null;
  publishedAt: string | null;
  publishedAtRaw: string | null;
  /** 按源站时区取的年份；时间解析不出来就是 null */
  publishedYear: number | null;
  /** 按正文估算的阅读分钟数；没有正文时为 null */
  readingMinutes: number | null;
  /** 是否含代码；列表层不知道时为 null，不伪装成 false */
  hasCode: boolean | null;
  tags: TagRef[];
  body: string;
  contentHash: string;
}

export interface NormalizeInput {
  item: ListItem;
  detail?: Detail | null;
  /** 源站本地时区（sources.timezone） */
  timezone: string;
  /** 列表页 URL，用来补相对链接 */
  base: string;
  /** 公司名（中英），用来剥掉标题末尾的站点名后缀，如 `｜得物技术` */
  brands?: readonly string[];
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** 摘要：源站自带优先；没有就从正文首段截。两条路都过 stripHtml + 200 字上限 */
function buildSummary(item: ListItem, body: string): string {
  const fromSource = item.summary ? stripHtml(item.summary) : "";
  if (fromSource) return truncateSummary(fromSource);
  return truncateSummary(stripHtml(body));
}

/** 全量指纹：标题 + 摘要 + 正文，变了才重写正文文件与 FTS */
export function contentHash(title: string, summary: string, body: string): string {
  return createHash("sha256").update(`${title}\n${summary}\n${body}`).digest("hex");
}

/**
 * 列表层指纹：只有标题与摘要。
 * 增量运行时用它判断「是否值得再进详情页」——不落列，直接拿库里的 title/summary 重算。
 */
export function listHash(title: string, summary: string): string {
  return createHash("sha256").update(`${title}\n${summary}`).digest("hex");
}

export function normalizePost(input: NormalizeInput): NormalizedPost | null {
  const { item, detail, timezone, base, brands = [] } = input;

  // 详情页优先：sitemap 这类列表没有标题，只有详情页能给出
  const rawTitle = cleanText(detail?.title ?? item.title);
  if (!rawTitle) return null;
  // 站点名后缀在算 title_norm 与指纹之前就剥掉，否则去重和「内容是否变化」都会被它带偏
  const title = stripSiteSuffix(rawTitle, brands);

  const canonicalUrl = canonicalizeUrl(item.url, base);
  if (!canonicalUrl) return null;

  const publishedAtRaw =
    cleanText(detail?.publishedAtRaw) ?? cleanText(item.publishedAtRaw) ?? null;
  const publishedAt = parsePublishedAt(publishedAtRaw, timezone);
  const publishedYear = yearInTimeZone(publishedAt, timezone);

  const body = (detail?.body ?? item.body ?? "").slice(0, MAX_BODY_CHARS);
  const summary = buildSummary(item, body);

  const tags = detail?.tags ?? item.tags ?? [];

  return {
    canonicalUrl,
    title,
    titleNorm: titleNorm(title),
    summary,
    author: cleanText(detail?.author ?? item.author),
    coverUrl: canonicalizeUrl(detail?.coverUrl ?? item.coverUrl ?? "", canonicalUrl),
    publishedAt,
    publishedAtRaw,
    publishedYear,
    readingMinutes: readingMinutes(body),
    hasCode: detail?.hasCode ?? item.hasCode ?? null,
    tags,
    body,
    contentHash: contentHash(title, summary, body),
  };
}
