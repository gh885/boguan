/** 列表分页的公共参数。参考站一次渲染全部；博观按 ARCHITECTURE §6 走静态分页。 */
export const PAGE_SIZE = 10;

/**
 * 索引页（标签 / 公司 / 年份 / 搜索）每页条目数。
 *
 * 首页是最新要闻，保持 10 条版位；索引页是目录，两栏 × 10 行读起来更完整。
 * `/page/2+` 仍是首页的续版，继续用 PAGE_SIZE，避免与头版重复。
 */
export const INDEX_PAGE_SIZE = 20;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageOffset(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

/** `/` → `/page/2`；`/company/x` → `/company/x/page/2`；第 1 页回到基路径。 */
export function pagePath(basePath: string, page: number): string {
  const base = basePath.replace(/\/$/, "") || "/";
  if (page <= 1) return base;
  return base === "/" ? `/page/${page}` : `${base}/page/${page}`;
}
