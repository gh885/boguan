import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { firstTextNode, htmlToText } from "../extract";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

/**
 * 有赞技术团队（Ghost 站）。列表页是静态 HTML，分页走 `/page/N/`。
 *
 * 三个实测结论，都是踩过才知道的：
 * - 列表页时间是 `28 Oct 2022`，没有时区，交给 normalize 按源站时区解释。
 * - 标签在 `<article class="post tag-big-data ...">` 里是 **slug**，中文名在侧栏标签导航里。
 *   对不上名字的（源站自己的拼音别名）不入库，记进日志等人工补映射。
 * - 这一站的 HTML 会让轻量解析器丢掉整段正文，所以用 cheerio，并且**解析不到正文就抛错**：
 *   宁可让这一条进 `crawl_failures`，也不要静默入一条空正文。
 */

/** 正文短于这个长度就当作解析失败，而不是「一篇很短的文章」 */
const MIN_BODY_CHARS = 200;
const TAG_PREFIX = "tag-";

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

function cardCover(card: Cheerio<Element>): string | undefined {
  const style = card.find("i").first().attr("style");
  return style?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
}

export const youzanAdapter: SourceAdapter = {
  slug: "youzan",
  capabilities: { list: "html", detail: "html" },

  pageUrl(listUrl, page) {
    if (page <= 1) return listUrl;
    return new URL(`/page/${page}/`, listUrl).toString();
  },

  async fetchList(ctx, page) {
    const url = this.pageUrl(ctx.source.listUrl, page);
    const response = await ctx.fetcher.page(url);
    // 404 = 翻到底了（Ghost 对越界页码返回 404），这是正常结束，不是失败
    if (response.status === 404) return [];
    if (!response.text) throw new Error(response.error ?? `列表页为空：${url}`);

    const $ = load(response.text);
    const names = tagNameMap($);
    const items: ListItem[] = [];

    $("article.post").each((_, element) => {
      const card = $(element);
      const anchor = card.find(".post-title a").first();
      const title = anchor.text().replace(/\s+/g, " ").trim();
      const href = anchor.attr("href");
      if (!title || !href) return;

      items.push({
        url: new URL(href, url).toString(),
        title,
        publishedAtRaw: firstTextNode(card.find(".post-date").get(0)),
        summary: card.find(".post-excerpt").first().text().trim() || undefined,
        tags: tagsFromClass(card.attr("class"), names),
        coverUrl: cardCover(card),
      });
    });

    // 200 但一条都没解析出来，几乎一定是选择器失效——让它响，不要静默当成「没有下一页」
    if (items.length === 0) {
      throw new Error(`列表页解析出 0 条，选择器可能失效：${url}`);
    }
    return items;
  },

  async fetchDetail(ctx, url): Promise<Detail> {
    const response = await ctx.fetcher.page(url);
    if (!response.text) throw new Error(response.error ?? `详情页为空：${url}`);

    const $ = load(response.text);
    const content = $(".post-content").first();
    if (content.length === 0) throw new Error(`详情页缺少 .post-content：${url}`);

    const body = htmlToText(content.html() ?? "");
    if (body.length < MIN_BODY_CHARS) {
      throw new Error(`详情页正文只有 ${body.length} 字，选择器可能失效：${url}`);
    }

    return {
      body,
      author: $(".post-author a").first().text().trim() || undefined,
      publishedAtRaw: firstTextNode($(".post-date").get(0)),
      tags: tagsFromClass($("article.post").first().attr("class"), tagNameMap($)),
      coverUrl: $(".post-header img").first().attr("src") ?? undefined,
    };
  },
};
