import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

/**
 * 中文分词。FTS5 的 unicode61 分词器不切中文，整段会被当成一个 token，
 * 所以入库前与查询前都要过这里，token 之间用空格连接（见 docs/ARCHITECTURE.md §7）。
 *
 * 词典加载约 50ms，进程内只做一次；crawler 与 web 的 SSR 搜索共用这一份。
 */

let instance: Jieba | null = null;

function jieba(): Jieba {
  instance ??= Jieba.withDict(dict);
  return instance;
}

/**
 * 统一空白、去掉零宽字符与控制字符——它们会让 FTS 的 token 变成不可查询的碎片。
 * `\p{Cc}` 覆盖 C0/C1 控制符；零宽字符属于 `\p{Cf}`，单独点名。
 */
function clean(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 文本 → FTS5 索引内容（空格分隔的 token 串） */
export function segment(text: string): string {
  const normalized = clean(text);
  if (!normalized) return "";
  return jieba()
    .cut(normalized, true)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .join(" ");
}

/**
 * 用户输入 → MATCH 表达式。
 * 每个 token 都用双引号包住，避免 `AND`、`*`、`-`、`(` 这类字符被当成 FTS5 语法。
 */
export function toMatchQuery(input: string): string {
  return segment(input)
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}
