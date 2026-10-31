import { load, type Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { hasCodeInHtml } from "../../../src/lib/domain/code";
import { htmlToText } from "../extract";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

/**
 * 得物技术团队（Nuxt SSR 站）。列表页是服务端渲染的 HTML，翻页走 `?page=N`。
 *
 * 实测结论：
 * - 列表 10 条/页、共约 20 页，越界页返回 **200 + 空列表**（不是 404）：所以「第 1 页必须有条目、
 *   后面的空页当作到底」——否则选择器失效会被当成「没有下一页」静默吞掉。
 * - 列表给绝对时间 `2026-07-13 17:07:05`（无时区）→ 按源站时区解释。
 * - 分类只有 8 个（技术思考 / AI&数据 / Java / 运维&稳定生产 / 大前端 / 测试 / Golang / 音视频），
 *   是中文名，靠 `SEED_TAG_ALIASES` 映射到已有标签，跨公司也能对齐（大前端 → 前端、测试 → 测试）。
 * - 详情页正文是 `#articleCont`（markdown 渲染结果），标题 `h1.title`，作者与时间在 `.author` / `.created-at`。
 */

/** 正文短于这个长度就当作解析失败，而不是「一篇很短的文章」 */
const MIN_BODY_CHARS = 200;

/** 「编辑：技术运营」→「技术运营」；「归类：大前端」→「大前端」 */
function stripLabel(text: string, label: string): string {
  return text.replace(new RegExp(`^${label}[:：]\\s*`), "").trim();
}

/** 列表卡片的分类链接就是源站标签（中文名，交给 tag_aliases 映射） */
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
        // 结构是「分类 / 编辑：作者 / 日期」，取后两个 span，不靠文本猜
        author: stripLabel(other.eq(1).text().trim(), "编辑") || undefined,
        publishedAtRaw: other.last().text().trim() || undefined,
        tags: cardTags(card),
      });
    });

    // 越界页是 200 + 空列表；只有第 1 页空才说明选择器失效
    if (items.length === 0 && page === 1) {
      throw new Error(`列表页解析出 0 条，选择器可能失效：${url}`);
    }
    return items;
  },

  async fetchDetail(ctx, url): Promise<Detail> {
    const response = await ctx.fetcher.page(url);
    if (!response.text) throw new Error(response.error ?? `详情页为空：${url}`);

    const $ = load(response.text);
    const content = $("#articleCont").first();
    if (content.length === 0) throw new Error(`详情页缺少 #articleCont：${url}`);

    const contentHtml = content.html() ?? "";
    const body = htmlToText(contentHtml);
    if (body.length < MIN_BODY_CHARS) {
      throw new Error(`详情页正文只有 ${body.length} 字，选择器可能失效：${url}`);
    }

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
