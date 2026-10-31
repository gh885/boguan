/**
 * 标签页的可索引门槛（ARCHITECTURE §8）。
 *
 * 556 篇语料里 420 个标签有 299 个只有 1 篇——「一个标题 + 一篇卡片」的页面
 * 占 sitemap 的七成，是典型的薄内容。门槛 3 之后剩 70 个标签页，
 * 而**只出现在薄标签里、没有别的标签兜底的文章只有 3 篇**，几乎不损失可达性。
 *
 * 门槛以下的标签页不 404：`noindex, follow`，老外链与站内点击都还能用。
 */
export const TAG_MIN_POSTS = 3;

export function isIndexableTag(postCount: number): boolean {
  return postCount >= TAG_MIN_POSTS;
}
