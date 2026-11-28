import { collapseWhitespace } from "@boguan/domain";
import { load } from "cheerio";

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "br",
  "hr",
]);

interface DomNode {
  type?: string;
  tagName?: string;
  data?: string;
  children?: DomNode[];
}

function walk(node: DomNode, out: string[]): void {
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      out.push(child.data ?? "");
      continue;
    }
    if (child.type !== "tag") continue;
    const tag = child.tagName?.toLowerCase() ?? "";
    if (SKIP.has(tag)) continue;
    walk(child, out);
    if (BLOCK.has(tag)) out.push("\n");
  }
}

export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const $ = load(html, null, false);
  const out: string[] = [];
  walk($.root()[0] as unknown as DomNode, out);

  return out
    .join("")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0)
    .join("\n");
}

export function firstTextNode(node: unknown): string | undefined {
  const children = (node as unknown as DomNode | undefined)?.children ?? [];
  for (const child of children) {
    if (child.type !== "text") continue;
    const text = collapseWhitespace(child.data ?? "");
    if (text) return text;
  }
  return undefined;
}
