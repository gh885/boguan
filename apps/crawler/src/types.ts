export interface TagRef {
  raw: string;
  name?: string;
}

export interface ListItem {
  url: string;
  title?: string;
  publishedAtRaw?: string;
  summary?: string;
  author?: string;
  tags?: TagRef[];
  body?: string;
  hasCode?: boolean;
  coverUrl?: string;
}

export interface Detail {
  title?: string;
  publishedAtRaw?: string;
  author?: string;
  tags?: TagRef[];
  body?: string;
  hasCode?: boolean;
  coverUrl?: string;
}
