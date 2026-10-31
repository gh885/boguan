/** 索引页（切片版）的共享数据形状。组件与页面都从这里取类型，避免从 .astro 导出。 */

export interface IndexFacetItem {
  label: string;
  lang?: string;
  href?: string;
  active?: boolean;
  /** 已激活的筛选项：点击整个 chip 移除；不传则渲染成不可点的当前项。 */
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
