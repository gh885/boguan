/** 列表分页的公共参数。参考站一次渲染全部；博观按 ARCHITECTURE §6 走静态分页。 */
export const PAGE_SIZE = 10;

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
