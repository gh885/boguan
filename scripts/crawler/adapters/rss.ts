import Parser from "rss-parser";
import { hasCodeInHtml } from "../../../src/lib/domain/code";
import { htmlToText } from "../extract";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

/**
 * 通用 RSS / Atom 适配器。
 *
 * 解析交给 `rss-parser`：它已经处理了 RSS 2.0 与 Atom 的形态差异（`link` 数组的
 * `rel="alternate"`、`dc:creator`、`content:encoded`、CDATA），这些胶水自己写一遍
 * 只会写出一个更差的版本。
 *
 * 时间**不用** rss-parser 归一后的 `isoDate`：它按运行环境时区解释无时区串，
 * 我们要的是源站原始串 + `sources.timezone`（见 ARCHITECTURE §5「归一」）。
 *
 * 列表页就给全文的源（美团技术团队用 `@vuepress/plugin-feed`，`content:encoded` 是整篇）
 * 用 `detail: "none"`，一条请求换一篇正文。
 */

export interface RssAdapterOptions {
  slug: string;
  /** `none` = 正文来自 feed；`html` = 需要再抓详情页 */
  detail?: "none" | "html";
  /** 有些 feed 不给 per-item 时间，但 URL 里带 /YYYY/MM/DD/（美团就是这样） */
  dateFromUrl?: boolean;
}

const parser = new Parser();

/** feed 里的字段可能是字符串、数组或对象，统一收成「有内容的字符串」 */
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
      // feed 不翻页：第 2 页起返回空列表，由管道自然结束
      return listUrl;
    },

    async fetchList(ctx, page) {
      if (page > 1) return [];

      const response = await ctx.fetcher.page(ctx.source.listUrl);
      if (!response.text) throw new Error(response.error ?? "feed 为空");

      const feed = await parser.parseString(response.text);
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
        // 只有 feed 给全了正文才用；否则留给详情页，避免把「摘要」当正文入库
        const body = detail === "none" && encoded ? htmlToText(encoded) : undefined;
        const hasCode = detail === "none" && encoded ? hasCodeInHtml(encoded) : undefined;

        const categories: TagRef[] = (entry.categories ?? [])
          .map((category) => str(category))
          .filter((category): category is string => !!category)
          .map((raw) => ({ raw }));

        items.push({
          url,
          title,
          // 保留源站原始串；没有就让 domain/date 按源站时区解释
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
      const response = await ctx.fetcher.page(url);
      if (!response.text) throw new Error(response.error ?? "详情页为空");
      return { body: htmlToText(response.text), hasCode: hasCodeInHtml(response.text) };
    },
  };
}
