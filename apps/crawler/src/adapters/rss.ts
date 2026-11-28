import { hasCodeInHtml } from "@boguan/domain";
import Parser from "rss-parser";
import { htmlToText } from "../extract";
import { requirePageText } from "../fetch";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

export interface RssAdapterOptions {
  slug: string;
  detail?: "none" | "html";
  dateFromUrl?: boolean;
}

const parser = new Parser();

function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = str(item);
      if (found) return found;
    }
  }
  return undefined;
}

function dateFromPath(url: string): string | undefined {
  const match = url.match(/\/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[/.]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function createRssAdapter(options: RssAdapterOptions): SourceAdapter {
  const { slug, detail = "html", dateFromUrl = false } = options;

  return {
    slug,
    capabilities: { list: "rss", detail },

    pageUrl(listUrl) {
      return listUrl;
    },

    async fetchList(ctx, page) {
      if (page > 1) return [];

      const response = await ctx.fetcher.page(ctx.source.listUrl);
      const xml = requirePageText(response, "feed");
      if (xml === null) return [];
      const feed = await parser.parseString(xml);
      if (feed.items.length === 0) {
        ctx.log("feed 里没有条目，检查 listUrl 是否还是订阅地址");
        return [];
      }

      const items: ListItem[] = [];
      for (const entry of feed.items) {
        const url = str(entry.link) ?? str(entry.guid);
        const title = str(entry.title);
        if (!url || !title) continue;

        const encoded = str(entry["content:encoded"]);
        const body = detail === "none" && encoded ? htmlToText(encoded) : undefined;
        const hasCode = detail === "none" && encoded ? hasCodeInHtml(encoded) : undefined;

        const categories: TagRef[] = (entry.categories ?? [])
          .map((category) => str(category))
          .filter((category): category is string => !!category)
          .map((raw) => ({ raw }));

        items.push({
          url,
          title,
          publishedAtRaw: str(entry.pubDate) ?? (dateFromUrl ? dateFromPath(url) : undefined),
          summary: str(entry.contentSnippet) ?? str(entry.summary),
          author: str(entry.creator) ?? str(entry.author),
          tags: categories,
          body,
          hasCode,
        });
      }
      return items;
    },

    async fetchDetail(ctx, url): Promise<Detail> {
      const response = await ctx.fetcher.page(url, { conditional: false });
      const html = requirePageText(response, "详情页");
      if (html === null) throw new Error(`详情页未变化但本地没有正文：${url}`);
      return { body: htmlToText(html), hasCode: hasCodeInHtml(html) };
    },
  };
}
