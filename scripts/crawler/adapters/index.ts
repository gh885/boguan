import { dewuAdapter } from "./dewu";
import { createRssAdapter } from "./rss";
import type { SourceAdapter } from "./types";
import { youzanAdapter } from "./youzan";

/**
 * 适配器注册表：`sources.adapter` 里的字符串就是这里的 key。
 * 新增一个源 = 新增一个文件 + 一条 sources 记录，管道代码不动。
 */
export const ADAPTERS: Record<string, SourceAdapter> = {
  "meituan-rss": createRssAdapter({ slug: "meituan-rss", detail: "none", dateFromUrl: true }),
  youzan: youzanAdapter,
  dewu: dewuAdapter,
};

export function adapterFor(slug: string): SourceAdapter {
  const adapter = ADAPTERS[slug];
  if (!adapter) throw new Error(`未注册的适配器：${slug}`);
  return adapter;
}
