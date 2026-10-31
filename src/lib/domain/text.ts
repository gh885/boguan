/**
 * 文本归一：HTML → 纯文本、摘要截断、空白折叠。
 *
 * 摘要上限是硬性规则 1 的底线，数据库里还有 CHECK 约束兜底（`length(summary) <= 200`）。
 * 这里用码点计数，与 SQLite 的 `length()` 对齐，避免 emoji 让两边算出不同长度。
 */

/** 摘要硬上限（字）。**这是规则上限，不是展示目标**：卡片上按两行裁（见 ARCHITECTURE §10） */
export const SUMMARY_MAX = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
  times: "×",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 空白折叠：普通空白 + 全角空格 + 零宽字符 */
export function collapseWhitespace(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

const BLOCK_BOUNDARY =
  /<\s*(?:br|hr|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre|\/tr|\/section|\/article)\s*\/?>/gi;

/** HTML 片段 → 纯文本。只处理「抽取」需要的程度，不追求完整 HTML 语义 */
export function stripHtml(input: string): string {
  const withoutHidden = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutHidden.replace(BLOCK_BOUNDARY, "\n");
  return collapseWhitespace(decodeEntities(withBreaks.replace(/<[^>]+>/g, " ")));
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

/** 句末收口：在句末标点后截断，不留半个词（§5「归一」第 3 条） */
const SENTENCE_END = /[。！？!?；;\n]/g;

/**
 * 把文本截成 ≤ `max` 字的摘要。
 * 策略：优先在 60% 之后的第一个句末标点处收口；找不到就硬切到 `max` 并去掉尾部的半个标点。
 */
export function truncateSummary(input: string, max = SUMMARY_MAX): string {
  const text = collapseWhitespace(input);
  const chars = codePoints(text);
  if (chars.length <= max) return text;

  const head = chars.slice(0, max).join("");
  let cut = -1;
  for (const match of head.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + 1;
    if (end >= Math.floor(max * 0.6)) cut = end;
  }

  const picked = cut > 0 ? head.slice(0, cut) : chars.slice(0, max).join("");
  return picked.replace(/[\s。！？!?；;，,、：:（(“‘\-—]+$/u, "").trim();
}
