import { dewuAdapter } from "./dewu";
import { createRssAdapter } from "./rss";
import type { SourceAdapter } from "./types";
import { youzanAdapter } from "./youzan";

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
