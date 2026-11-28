import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
import { collapseWhitespace } from "@boguan/domain";

let instance: Jieba | null = null;

function jieba(): Jieba {
  instance ??= Jieba.withDict(dict);
  return instance;
}

export function segment(text: string): string {
  const normalized = collapseWhitespace(text);
  if (!normalized) return "";
  return jieba()
    .cut(normalized, true)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .join(" ");
}

export function toMatchQuery(input: string): string {
  return segment(input)
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}
