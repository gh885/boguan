import { localizePath } from "./i18n";
import type { Locale } from "./i18n/config";

export type SearchParams = Record<string, string | number | boolean | null | undefined>;

/**
 * 唯一的搜索/筛选地址生成器。静态列表页的「含代码」入口、搜索页的切换与分页
 * 都走这里，避免各页手拼查询串时漏掉 company / tag / year。
 */
export function searchHref(locale: Locale, params: SearchParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (value === true) {
      search.set(key, "1");
      continue;
    }
    if (value === false) continue;
    search.set(key, String(value));
  }
  const path = localizePath("/search", locale);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
