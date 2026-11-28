import {
  canonicalizeUrl,
  contentHash,
  parsePublishedAt,
  yearInTimeZone,
  decodeEntities,
  stripHtml,
  truncateSummary,
  stripSiteSuffix,
  readingMinutes,
  titleNorm,
} from "@boguan/domain";
import type { Detail, ListItem, TagRef } from "./types";

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
  publishedYear: number | null;
  readingMinutes: number | null;
  hasCode: boolean | null;
  tags: TagRef[];
  body: string;
  contentHash: string;
}

export interface NormalizeInput {
  item: ListItem;
  detail?: Detail | null;
  timezone: string;
  base: string;
  brands?: readonly string[];
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function buildSummary(item: ListItem, body: string): string {
  const fromSource = item.summary ? stripHtml(item.summary) : "";
  if (fromSource) return truncateSummary(fromSource);
  return truncateSummary(stripHtml(body));
}

export function normalizePost(input: NormalizeInput): NormalizedPost | null {
  const { item, detail, timezone, base, brands = [] } = input;

  const rawTitle = cleanText(detail?.title ?? item.title);
  if (!rawTitle) return null;
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
