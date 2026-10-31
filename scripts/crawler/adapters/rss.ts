import { XMLParser } from "fast-xml-parser";
import { htmlToText } from "../extract";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

/**
 * 通用 RSS / Atom 适配器。
 *
 * 列表页就给全文的源（美团技术团队用 `@vuepress/plugin-feed`，`content:encoded` 里是整篇）
 * 用 `detail: "none"`：一条请求换一篇正文，不再为每篇多打一次详情页。
 */

export interface RssAdapterOptions {
  slug: string;
  /** `none` = 正文来自 feed；`html` = 需要再抓详情页 */
  detail?: "none" | "html";
  /** 有些 feed 不给 per-item 时间，但 URL 里带 /YYYY/MM/DD/（美团就是这样） */
  dateFromUrl?: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  cdataPropName: "__cdata",
  parseTagValue: false,
  processEntities: true,
});

/** fast-xml-parser 的节点可能是 string / number / 数组 / {__cdata,#text,@_href,...} */
function textOf(node: unknown): string | undefined {
  if (node === null || node === undefined) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const value = textOf(item);
      if (value) return value;
    }
    return undefined;
  }
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    return (
      textOf(record.__cdata) ??
      textOf(record["#text"]) ??
      textOf(record["@_href"]) ??
      textOf(record.href) ??
      undefined
    );
  }
  return undefined;
}

/** Atom 的 link 是数组，优先 rel="alternate" */
function linkOf(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    const alternate = node.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>)["@_rel"] === "alternate",
    );
    return textOf(alternate) ?? textOf(node);
  }
  return textOf(node);
}

function asArray(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}

function tagRefs(node: unknown): TagRef[] {
  const refs: TagRef[] = [];
  for (const entry of asArray(node)) {
    const raw = textOf(entry);
    if (raw) refs.push({ raw });
  }
  return refs;
}

const DATE_FIELDS = ["pubDate", "published", "updated", "dc:date", "date"] as const;

function dateOf(item: Record<string, unknown>, url: string, fromUrl: boolean): string | undefined {
  for (const field of DATE_FIELDS) {
    const value = textOf(item[field]);
    if (value) return value;
  }
  if (!fromUrl) return undefined;
  const match = url.match(/\/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[/.]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function authorOf(item: Record<string, unknown>): string | undefined {
  const direct = textOf(item["dc:creator"]) ?? textOf(item.author) ?? textOf(item["itunes:author"]);
  if (direct) return direct;
  const author = item.author;
  if (author && typeof author === "object") {
    return textOf((author as Record<string, unknown>).name);
  }
  return undefined;
}

export function createRssAdapter(options: RssAdapterOptions): SourceAdapter {
  const { slug, detail = "html", dateFromUrl = false } = options;

  return {
    slug,
    capabilities: { list: "rss", detail },

    pageUrl(listUrl) {
      // feed 不翻页：第 2 页起返回空列表，由管道自然结束
      return listUrl;
    },

    async fetchList(ctx, page) {
      if (page > 1) return [];

      const response = await ctx.fetcher.page(ctx.source.listUrl);
      if (!response.text) throw new Error(response.error ?? "feed 为空");

      const parsed = parser.parse(response.text) as Record<string, unknown>;
      const rss = parsed.rss as Record<string, unknown> | undefined;
      const channel = rss?.channel as Record<string, unknown> | undefined;
      const feed = parsed.feed as Record<string, unknown> | undefined;
      const entries = asArray(channel?.item ?? feed?.entry ?? parsed.item);
      if (entries.length === 0) ctx.log("feed 里没有条目，检查 listUrl 是否还是订阅地址");

      const items: ListItem[] = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const url = linkOf(item.link) ?? textOf(item.guid);
        const title = textOf(item.title);
        if (!url || !title) continue;

        const content = textOf(item["content:encoded"]);
        const description =
          textOf(item.description) ?? textOf(item.summary) ?? textOf(item.content);
        // 正文只在 feed 里给全了才用；否则留给详情页，避免把「摘要」当正文入库
        const body = detail === "none" && content ? htmlToText(content) : undefined;

        items.push({
          url,
          title,
          publishedAtRaw: dateOf(item, url, dateFromUrl),
          summary: description ? htmlToText(description).slice(0, 400) : undefined,
          author: authorOf(item),
          tags: tagRefs(item.category ?? item["dc:subject"]),
          body,
        });
      }
      return items;
    },

    async fetchDetail(ctx, url): Promise<Detail> {
      const response = await ctx.fetcher.page(url);
      if (!response.text) throw new Error(response.error ?? "详情页为空");
      return { body: htmlToText(response.text) };
    },
  };
}
