/** 适配器与管道之间的中间结构（对应 §5 的 `SourceAdapter` 接口） */

/** 源站标签：`raw` 是源站写法，`name` 是源站自己显示的中文名（拿得到就带上） */
export interface TagRef {
  raw: string;
  name?: string;
}

/** 列表页解析出的一条 */
export interface ListItem {
  /** 绝对或相对 URL，由 normalize 归一 */
  url: string;
  /**
   * 列表页给的标题。sitemap 这类「只给 URL」的列表没有元数据，此时不传，
   * 标题与时间由详情页补（见 `Detail.title`）。
   */
  title?: string;
  /** 源站原始时间串，不解析，交给 domain/date 按源站时区解释 */
  publishedAtRaw?: string;
  summary?: string;
  author?: string;
  tags?: TagRef[];
  /** RSS 这类列表页就带全文的源，正文不用再进详情页 */
  body?: string;
  /** 列表页原始 HTML 里是否含 <pre>/<code>；拿不到 HTML 时不传 */
  hasCode?: boolean;
  coverUrl?: string;
}

/** 详情页补齐的字段 */
export interface Detail {
  /** 详情页标题：列表只给 URL 的源（sitemap）靠它拿标题 */
  title?: string;
  publishedAtRaw?: string;
  author?: string;
  tags?: TagRef[];
  body?: string;
  /** 详情页正文容器里是否含 <pre>/<code> */
  hasCode?: boolean;
  coverUrl?: string;
}
