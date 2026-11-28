export const HIDDEN_NON_ARTICLE = "non-article";

const SUFFIX_PATTERN = /^(.*?)\s*[｜|]\s*([^｜|]*)$/;

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
  return stripped.length > 0 ? stripped : title;
}

export const NON_ARTICLE_TAG = "tech-activity";

const EVENT_TITLE = /技术活动|沙龙|开放日|报名|meetup|马拉松|赛后回顾/i;

const TEAM_TITLE = /团队|介绍/;

export function isNonArticle(title: string, tagSlugs: readonly string[]): boolean {
  if (tagSlugs.includes(NON_ARTICLE_TAG)) return true;
  if (EVENT_TITLE.test(title)) return true;
  return tagSlugs.includes("team-introduction") && TEAM_TITLE.test(title);
}
