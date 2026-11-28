export const PAGE_SIZE = 10;

export const INDEX_PAGE_SIZE = 20;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageOffset(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

export function pagePath(basePath: string, page: number): string {
  const base = basePath.replace(/\/$/, "") || "/";
  if (page <= 1) return base;
  return base === "/" ? `/page/${page}` : `${base}/page/${page}`;
}
