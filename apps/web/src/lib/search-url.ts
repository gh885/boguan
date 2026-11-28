import { localizePath } from "./i18n";
import type { Locale } from "./i18n/config";

export type SearchParams = Record<string, string | number | boolean | null | undefined>;

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
