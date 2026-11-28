import { localizePath } from "./i18n";
import type { Locale } from "./i18n/config";

export const PAGE_SIZE = 10;

export const INDEX_PAGE_SIZE = 20;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageOffset(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

export function pagePath(basePath: string, page: number): string {
  const base = basePath.replace(/\/$/, "") || "/";
  if (page <= 1) return base;
  return base === "/" ? `/page/${page}` : `${base}/page/${page}`;
}

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

export type PaperSection = "home" | "companies" | "tags" | "years" | "editions";

export interface IndexFacetItem {
  label: string;
  lang?: string;
  href?: string;
  active?: boolean;
  removeHref?: string;
  count?: number;
}

export interface IndexFacetGroup {
  label?: string;
  items: IndexFacetItem[];
}

export interface IndexRailLink {
  label: string;
  href: string;
  count?: number;
  lang?: string;
  active?: boolean;
}

export interface IndexRailModule {
  title: string;
  links?: IndexRailLink[];
  body?: string;
  allHref?: string;
  allLabel?: string;
}

export interface IndexEmptyAction {
  label: string;
  href: string;
}
