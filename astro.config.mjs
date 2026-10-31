// @ts-check
import sitemap from "@astrojs/sitemap";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://boguan.dev",
  // URL 语言策略：默认语言（中文）不带前缀，其它语言带前缀。
  //   /            /company/meituan        → zh-CN
  //   /en/         /en/company/meituan     → en
  // 语言清单在 src/lib/i18n/config.ts，两处必须一致。
  i18n: {
    defaultLocale: "zh-CN",
    locales: ["zh-CN", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  // 搜索是唯一的 SSR 页面（静态列表页仍然在构建时生成），见 ARCHITECTURE §6。
  adapter: node({ mode: "standalone" }),
  integrations: [
    sitemap({
      // 键是 URL 里的语言段，值是 hreflang；默认语言没有前缀，但也要出现在映射里，
      // 否则 `/` 与 `/en/` 无法互相关联（见 ARCHITECTURE §8）。
      i18n: {
        defaultLocale: "zh-CN",
        locales: { "zh-CN": "zh-CN", en: "en" },
      },
      // 搜索页与筛选组合页是 noindex，不进 sitemap
      filter: (page) => !new URL(page).pathname.match(/(^|\/)search\/?$/),
    }),
  ],
});
