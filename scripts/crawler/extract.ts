import { load } from "cheerio";
import { collapseWhitespace } from "../../src/lib/domain/text";

/**
 * HTML → 纯文本。
 *
 * 用 cheerio（htmlparser2）而不是更轻的解析器：真实站点里内联脚本、半闭合标签很常见，
 * 轻量解析器会**静默**丢掉半个文档（有赞详情页就是一个例子），而正文变空是抓取里最难发现的故障。
 *
 * 这里只做「给检索用」的抽取：保段落换行、去掉脚本样式，不追求完整可读性算法。
 * 源站结构特殊的，先在适配器里把范围缩到正文容器再交给这里。
 */

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

/** HTML 片段 → 带段落换行的纯文本 */
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

/** 元素自己的第一个文本节点（跳过嵌套的子元素文本），用于「28 Oct 2022 | 5 min read」这类结构 */
export function firstTextNode(node: unknown): string | undefined {
  const children = (node as unknown as DomNode | undefined)?.children ?? [];
  for (const child of children) {
    if (child.type !== "text") continue;
    const text = collapseWhitespace(child.data ?? "");
    if (text) return text;
  }
  return undefined;
}
