import { load } from "cheerio";

export interface SitemapOptions {
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
