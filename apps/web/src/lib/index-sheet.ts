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
