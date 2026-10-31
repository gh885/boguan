import { load, type CheerioAPI } from "cheerio";
import { hasCodeInHtml } from "../../../src/lib/domain/code";
import { firstTextNode, htmlToText } from "../extract";
import { parseSitemapUrls } from "../sitemap";
import type { Detail, ListItem, TagRef } from "../types";
import type { SourceAdapter } from "./types";

/**
 * 有赞技术团队（Ghost 站）。
 *
 * **列表入口是 sitemap，不是翻页**：`sitemap-posts.xml` 一次请求给出全量文章 URL
 * （实测 351 条），翻页要 70+ 次请求、还得靠「第 N 页 404」判底。回填与增量共用同一条路：
 * 增量时已知 URL 一次请求都不发（管道对「列表只给 URL」的条目直接跳过），所以稳态仍是 1 次/天。
 * 代价是列表层拿不到标题与时间——都由详情页补，列表只负责「发现新条目」。
 *
 * 三个实测结论，都是踩过才知道的：
 * - 详情页时间是 `28 Oct 2022`，没有时区，交给 normalize 按源站时区解释。
 * - 标签在 `<article class="post tag-big-data ...">` 里是 **slug**，中文名在侧栏标签导航里。
 *   对不上名字的（源站自己的拼音别名）不入库，记进日志等人工补映射。
 * - 这一站的 HTML 会让轻量解析器丢掉整段正文，所以用 cheerio，并且**解析不到正文就抛错**：
 *   宁可让这一条进 `crawl_failures`，也不要静默入一条空正文。
 */

/** 正文短于这个长度就当作解析失败，而不是「一篇很短的文章」 */
const MIN_BODY_CHARS = 200;
const TAG_PREFIX = "tag-";

/**
 * 每个「页」切多少条 URL。分片是为了让 `--max-pages` 在所有源上语义一致，
 * 也让回填有进度可看；分片之间不再发请求（sitemap 只取一次，缓存在进程内）。
 */
const SITEMAP_PAGE_SIZE = 50;

/** Ghost 的固定路径段，不是文章；sitemap 里混进来就排掉 */
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

/** 文章页判定：单段路径 + 结尾斜杠，且不是保留路径（导出供测试） */
export function isPostUrl(url: URL): boolean {
  const match = url.pathname.match(/^\/([^/]+)\/$/);
  if (!match) return false;
  return !RESERVED_SEGMENTS.has(match[1]!.toLowerCase());
}

async function sitemapUrls(ctx: Parameters<SourceAdapter["fetchList"]>[0]): Promise<string[]> {
  const source = ctx.source.listUrl;
  if (cache?.source === source) return cache.urls;

  const response = await ctx.fetcher.page(source);
  if (!response.text) throw new Error(response.error ?? `站点地图为空：${source}`);

  const urls = parseSitemapUrls(response.text, source, { keep: isPostUrl });
  // 200 但一条都没解析出来，几乎一定是站点结构变了——让它响，不要静默当成「没有文章」
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

  // 站点地图没有翻页概念：每一「页」都是同一份清单的不同切片
  pageUrl(listUrl) {
    return listUrl;
  },

  async fetchList(ctx, page) {
    const urls = await sitemapUrls(ctx);
    const start = (page - 1) * SITEMAP_PAGE_SIZE;
    if (start >= urls.length) return [];

    const items: ListItem[] = urls
      .slice(start, start + SITEMAP_PAGE_SIZE)
      // 列表只给 URL：标题、时间、作者、标签、正文全部来自详情页
      .map((url) => ({ url }));
    return items;
  },

  async fetchDetail(ctx, url): Promise<Detail> {
    const response = await ctx.fetcher.page(url);
    if (!response.text) throw new Error(response.error ?? `详情页为空：${url}`);

    const $ = load(response.text);
    const content = $(".post-content").first();
    if (content.length === 0) throw new Error(`详情页缺少 .post-content：${url}`);

    const contentHtml = content.html() ?? "";
    const body = htmlToText(contentHtml);
    if (body.length < MIN_BODY_CHARS) {
      throw new Error(`详情页正文只有 ${body.length} 字，选择器可能失效：${url}`);
    }

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
