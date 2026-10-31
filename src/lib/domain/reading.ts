/**
 * 阅读时长估算。正文只存在于 crawler 侧，这里只做纯计算，
 * 把结果作为派生元数据落库（docs/ARCHITECTURE.md §4）。
 *
 * 中文按 400 字/分钟，英文/数字按 200 词/分钟；代码字符也算进中文侧，
 * 所以技术长文的估计会偏长一点——宁可高估，不要把 30 分钟的文章标成 3 分钟。
 */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD = /[A-Za-z0-9]+/g;

export const CJK_CHARS_PER_MINUTE = 400;
export const WORDS_PER_MINUTE = 200;

export function readingMinutes(text: string): number | null {
  const plain = text.trim();
  if (!plain) return null;

  const cjk = plain.match(CJK)?.length ?? 0;
  const rest = plain.replace(CJK, " ");
  const words = rest.match(WORD)?.length ?? 0;
  if (cjk === 0 && words === 0) return null;

  return Math.max(1, Math.ceil(cjk / CJK_CHARS_PER_MINUTE + words / WORDS_PER_MINUTE));
}
