import { hasCodeInHtml } from "@boguan/domain";
import type { CheerioAPI } from "cheerio";
import { fetchDetailContent } from "./detail";
import { firstTextNode } from "../extract";
import { requirePageText } from "../fetch";
import { parseSitemapUrls } from "../sitemap";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

const TAG_PREFIX = "tag-";

const SITEMAP_PAGE_SIZE = 50;

const RESERVED_SEGMENTS = new Set([
  "page",
  "tag",
  "author",
  "ghost",
  "rss",
  "content",
  "about",
  "sitemap",
]);

let cache: { source: string; urls: string[] } | null = null;

export function isPostUrl(url: URL): boolean {
  const match = url.pathname.match(/^\/([^/]+)\/$/);
  if (!match) return false;
  return !RESERVED_SEGMENTS.has(match[1]!.toLowerCase());
}

async function sitemapUrls(ctx: Parameters<SourceAdapter["fetchList"]>[0]): Promise<string[]> {
  const source = ctx.source.listUrl;
  if (cache?.source === source) return cache.urls;

  const response = await ctx.fetcher.page(source);
  const xml = requirePageText(response, `站点地图（${source}）`);
  if (xml === null) return [];

  const urls = parseSitemapUrls(xml, source, { keep: isPostUrl });
  if (urls.length === 0) {
    throw new Error(`站点地图里没有文章 URL，路径或格式可能变了：${source}`);
  }

  ctx.log(`站点地图给出 ${urls.length} 篇文章`);
  cache = { source, urls };
  return urls;
}

function tagNameMap($: CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $('a[href*="/tag/"]').each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const slug = href.match(/\/tag\/([^/?#]+)/)?.[1];
    const name = $(element).text().replace(/\s+/g, " ").trim();
    if (!slug || !name) return;
    map.set(slug, name);
  });
  return map;
}

function tagsFromClass(className: string | undefined, names: Map<string, string>): TagRef[] {
  if (!className) return [];
  const refs: TagRef[] = [];
  const seen = new Set<string>();

  for (const token of className.split(/\s+/)) {
    if (!token.startsWith(TAG_PREFIX)) continue;
    const raw = token.slice(TAG_PREFIX.length);
    const name = names.get(raw);
    if (!raw || !name || seen.has(raw)) continue;
    seen.add(raw);
    refs.push({ raw, name });
  }
  return refs;
}

export const youzanAdapter: SourceAdapter = {
  slug: "youzan",
  capabilities: { list: "sitemap", detail: "html" },

  pageUrl(listUrl) {
    return listUrl;
  },

  async fetchList(ctx, page) {
    const urls = await sitemapUrls(ctx);
    const start = (page - 1) * SITEMAP_PAGE_SIZE;
    if (start >= urls.length) return [];

    const items: ListItem[] = urls.slice(start, start + SITEMAP_PAGE_SIZE).map((url) => ({ url }));
    return items;
  },

  async fetchDetail(ctx, url): Promise<Detail> {
    const { $, contentHtml, body } = await fetchDetailContent(ctx, url, ".post-content");
    return {
      title: $(".post-title").first().text().trim() || $("h1").first().text().trim() || undefined,
      body,
      hasCode: hasCodeInHtml(contentHtml),
      author: $(".post-author a").first().text().trim() || undefined,
      publishedAtRaw: firstTextNode($(".post-date").get(0)),
      tags: tagsFromClass($("article.post").first().attr("class"), tagNameMap($)),
      coverUrl: $(".post-header img").first().attr("src") ?? undefined,
    };
  },
};
