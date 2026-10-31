/**
 * 标题与 slug。
 *
 * `titleNorm` 是跨源去重的比对键：同一篇稿子在官网和平台上，标题往往只差标点、
 * 空格和全半角（「如何在“不能出错”的系统里使用 AI Coding？」vs「如何在不能出错的系统里使用AI Coding」）。
 */

/** 标题归一：NFKC + 小写 + 只保留字母/数字/汉字，**复用为去重键** */
export function titleNorm(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 生成 ASCII slug。汉字不转拼音——生成规则不确定的名字一律由 seed 显式给 slug，
 * 这里的 `null` 就是「请人工指定」的信号（AGENTS：slug 不含中文）。
 */
export function slugify(input: string): string | null {
  // 含非 ASCII（汉字、日文、全角符号）就直接交回人工：猜拼音比留空更糟
  if (/[^\p{ASCII}]/u.test(input)) return null;
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}
