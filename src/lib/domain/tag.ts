/**
 * 标签归一（docs/ARCHITECTURE.md §5「标签」）。
 *
 * 源站标签写法五花八门（`big-data` / `大数据` / `Big Data`），统一成小写、去重后再查
 * `tag_aliases` 映射到规范标签。规范标签的 slug 必须是 ASCII，由 seed 或映射表显式给出。
 */

/** 源站原始标签 → 比对键：去 `#`、NFKC、折叠空白、小写 */
export function normalizeRawTag(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/^#+/, "")
    .replace(/[\s\u3000]+/g, " ")
    .trim()
    .toLowerCase();
}

/** 一批原始标签去重（保持首次出现的顺序，归一后相同即视为同一个） */
export function normalizeRawTags(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = normalizeRawTag(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
