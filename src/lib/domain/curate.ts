/**
 * 内容清洗规则（ARCHITECTURE §5「清洗」）。
 *
 * 纯函数，crawler 入库时用一次、`vpr db:curate` 对存量数据再跑一遍——
 * **同一套规则只有一个实现**，否则「新抓的干净、老数据脏」这种不一致迟早出现。
 */

/** 不可见原因：非文章页。以后人工下架用别的值，`db:curate` 只碰这一种 */
export const HIDDEN_NON_ARTICLE = "non-article";

/**
 * 标题里的站点后缀分隔符：`｜`（全角）与 `|`（半角）。
 * 只认最后一个分隔符之后的片段，`A｜B｜得物技术` → 后缀是 `得物技术`。
 */
const SUFFIX_PATTERN = /^(.*?)\s*[｜|]\s*([^｜|]*)$/;

/**
 * 剥掉标题末尾的站点名后缀，例如「…范式转移｜得物技术」→「…范式转移」。
 *
 * 判定收窄成「后缀里包含公司名」：得物 197 篇里 67 篇带 `｜得物技术`，
 * 而「一次大量删除导致慢查的分析｜归因篇」这种真副标题必须原样保留。
 * 剥掉它也顺手修好了跨源去重：`title_norm` 参与判重，带站点名的标题和别处同篇文章对不上。
 */
export function stripSiteSuffix(title: string, brands: readonly string[]): string {
  const match = SUFFIX_PATTERN.exec(title.trim());
  if (!match) return title;

  const [, head, tail] = match;
  const normalizedTail = tail.replace(/\s+/g, "");
  const isSiteName = brands.some(
    (brand) => brand.length > 0 && normalizedTail.includes(brand.replace(/\s+/g, "")),
  );
  if (!isSiteName) return title;

  const stripped = head.trim();
  // 只剩后缀说明标题本身就不完整，别把它剥成空串
  return stripped.length > 0 ? stripped : title;
}

/** 源站把活动也当文章发；这个标签本身就是可靠信号，命中即下架 */
export const NON_ARTICLE_TAG = "tech-activity";

/**
 * 活动页的标题信号。源站标签只有部分站点给（美团没有标签、得物只给分类），
 * 所以标题必须能独立判一次。`招聘` 故意不收——「招聘系统的架构演进」是正经文章。
 */
const EVENT_TITLE = /技术活动|沙龙|开放日|报名|meetup|马拉松|赛后回顾/i;

/**
 * 团队介绍的标题信号。有赞把「团队文化」类文章（OKR、项目例会、入职随笔）
 * 也打了 `team-introduction`，一刀切会把管理实践文章一起下架，
 * 所以这个标签要**配合标题**才生效。
 */
const TEAM_TITLE = /团队|介绍/;

/**
 * 是不是「非文章页」（活动报名、团队介绍、招聘帖）。
 *
 * 这是**可见性**判断，不是删除：命中就 `is_visible = false` + 记原因，
 * 页面、搜索、sitemap 一起干净，但数据还在，改判只改一行（见 ARCHITECTURE §3）。
 */
export function isNonArticle(title: string, tagSlugs: readonly string[]): boolean {
  if (tagSlugs.includes(NON_ARTICLE_TAG)) return true;
  if (EVENT_TITLE.test(title)) return true;
  return tagSlugs.includes("team-introduction") && TEAM_TITLE.test(title);
}
