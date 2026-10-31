import type { PoliteFetcher } from "../fetch";
import type { Detail, ListItem } from "../types";

/** 适配器接口（docs/ARCHITECTURE.md §5）。新增一个源 = 一个文件 + 一条 sources 记录。 */

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
  /**
   * 「怎么解析」的唯一声明处，数据库里不重复存这些信息。
   * `detail: 'none'` 表示列表页就给全了正文（RSS 常见），不必再进详情页。
   */
  capabilities: { list: "html" | "rss" | "json" | "sitemap"; detail: "html" | "json" | "none" };
  /** 第 `page` 页的 URL，page 从 1 开始；不支持翻页的源返回同一个地址 */
  pageUrl(listUrl: string, page: number): string;
  /** 返回空数组表示没有下一页 */
  fetchList(ctx: AdapterContext, page: number): Promise<ListItem[]>;
  fetchDetail?(ctx: AdapterContext, url: string): Promise<Detail>;
}
