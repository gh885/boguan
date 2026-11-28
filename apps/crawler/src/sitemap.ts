import { load } from "cheerio";

/**
 * 站点地图解析：把 `<loc>` 全抓出来。
 *
 * 为什么值得单独一个模块：很多站点（Ghost / Hexo / Hugo / 各种静态博客）都发 sitemap，
 * 而 sitemap 比翻页是更好的**回填**入口——一次请求就是全量 URL 清单，不用担心
 * 「第 N 页开始 404」「列表页只给最近 N 条」。翻页那套仍保留给只发 HTML 列表的源。
 *
 * 只处理 leaf sitemap（`<urlset>`）。指向 index（`<sitemapindex>`）的地址要换成
 * 具体的子图，例如有赞的 `sitemap-posts.xml`；这里不递归，避免一进站点就多打几个请求。
 */
export interface SitemapOptions {
  /** 过滤：只保留真正的文章页（默认全收） */
  keep?: (url: URL) => boolean;
}

export function parseSitemapUrls(
  xml: string,
  base: string,
  options: SitemapOptions = {},
): string[] {
  const $ = load(xml, { xml: { xmlMode: true } });
  const urls: string[] = [];
  const seen = new Set<string>();

  $("loc").each((_, element) => {
    const loc = $(element).text().trim();
    if (!loc) return;

    let url: URL;
    try {
      url = new URL(loc, base);
    } catch {
      return;
    }
    if (options.keep && !options.keep(url)) return;

    const key = url.toString();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(key);
  });

  return urls;
}
