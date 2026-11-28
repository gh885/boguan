import type { PoliteFetcher } from "../fetch";
import type { Detail, ListItem } from "../types";

export interface AdapterContext {
  fetcher: PoliteFetcher;
  log: (message: string) => void;
  source: {
    slug: string;
    name: string;
    listUrl: string;
  };
}

export interface SourceAdapter {
  slug: string;
  capabilities: { list: "html" | "rss" | "json" | "sitemap"; detail: "html" | "json" | "none" };
  pageUrl(listUrl: string, page: number): string;
  fetchList(ctx: AdapterContext, page: number): Promise<ListItem[]>;
  fetchDetail?(ctx: AdapterContext, url: string): Promise<Detail>;
}
