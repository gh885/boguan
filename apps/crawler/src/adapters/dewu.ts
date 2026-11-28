import { hasCodeInHtml } from "@boguan/domain";
import { load, type Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { fetchDetailContent } from "./detail";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

function stripLabel(text: string, label: string): string {
  return text.replace(new RegExp(`^${label}[:：]\\s*`), "").trim();
}

function cardTags(card: Cheerio<Element>): TagRef[] {
  const name = card.find("p.other a").first().text().trim();
  return name ? [{ raw: name, name }] : [];
}

export const dewuAdapter: SourceAdapter = {
  slug: "dewu",
  capabilities: { list: "html", detail: "html" },

  pageUrl(listUrl, page) {
    if (page <= 1) return listUrl;
    const url = new URL(listUrl);
    url.searchParams.set("page", String(page));
    return url.toString();
  },

  async fetchList(ctx, page) {
    const url = this.pageUrl(ctx.source.listUrl, page);
    const response = await ctx.fetcher.page(url);
    if (!response.text) throw new Error(response.error ?? `列表页为空：${url}`);

    const $ = load(response.text);
    const items: ListItem[] = [];

    $("li.article-item").each((_, element) => {
      const card = $(element);
      const anchor = card.find("h3 a").first();
      const title = anchor.text().replace(/\s+/g, " ").trim();
      const href = anchor.attr("href");
      if (!title || !href) return;

      const other = card.find("p.other span");
      items.push({
        url: new URL(href, url).toString(),
        title,
        summary: card.find("p.description").first().text().trim() || undefined,
        author: stripLabel(other.eq(1).text().trim(), "编辑") || undefined,
        publishedAtRaw: other.last().text().trim() || undefined,
        tags: cardTags(card),
      });
    });

    if (items.length === 0 && page === 1) {
      throw new Error(`列表页解析出 0 条，选择器可能失效：${url}`);
    }
    return items;
  },

  async fetchDetail(ctx, url): Promise<Detail> {
    const { $, contentHtml, body } = await fetchDetailContent(ctx, url, "#articleCont");
    const category = stripLabel($(".category").first().text().trim(), "归类");
    return {
      title: $("h1.title").first().text().trim() || undefined,
      body,
      hasCode: hasCodeInHtml(contentHtml),
      author: stripLabel($(".author").first().text().trim(), "编辑") || undefined,
      publishedAtRaw: $(".created-at").first().text().trim() || undefined,
      tags: category ? [{ raw: category, name: category }] : [],
    };
  },
};
