export interface SourceEntry {
  companySlug: string;
  slug: string;
  name: string;
  adapter: string;
  listUrl: string;
  timezone?: string;
  lang?: string;
  priority?: number;
}

export const SOURCES: readonly SourceEntry[] = [
  {
    companySlug: "meituan",
    slug: "meituan-tech-rss",
    name: "美团技术团队",
    adapter: "meituan-rss",
    listUrl: "https://tech.meituan.com/rss.xml",
    priority: 10,
  },
  {
    companySlug: "youzan",
    slug: "youzan-tech",
    name: "有赞技术团队",
    adapter: "youzan",
    listUrl: "https://tech.youzan.com/sitemap-posts.xml",
    priority: 20,
  },
  {
    companySlug: "dewu",
    slug: "dewu-tech",
    name: "得物技术团队",
    adapter: "dewu",
    listUrl: "https://tech.dewu.com/",
    priority: 30,
  },
];

export const DEFAULT_SOURCE_TIME_ZONE = "Asia/Shanghai";

export const DEFAULT_SOURCE_LANG = "zh-CN";
