import { decodeHTML } from "entities";

export const SUMMARY_MAX = 200;

export function decodeEntities(input: string): string {
  return decodeHTML(input);
}

export function collapseWhitespace(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

const BLOCK_BOUNDARY =
  /<\s*(?:br|hr|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre|\/tr|\/section|\/article)\s*\/?>/gi;

export function stripHtml(input: string): string {
  const withoutHidden = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutHidden.replace(BLOCK_BOUNDARY, "\n");
  return collapseWhitespace(decodeEntities(withBreaks.replace(/<[^>]+>/g, " ")));
}

const SENTENCE_END = /[。！？!?；;\n]/g;

export function truncateSummary(input: string, max = SUMMARY_MAX): string {
  const text = collapseWhitespace(input);
  const chars = Array.from(text);
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
