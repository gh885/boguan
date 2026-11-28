// @ts-check
import { editionSummaries, openWebDatabase, tagIndex } from "@boguan/database/web-read";
import { isIndexableCollection } from "@boguan/domain";
import sitemap from "@astrojs/sitemap";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

const webDb = openWebDatabase();

// 薄标签页只有站内入口，不进 sitemap：门槛常量在 @boguan/domain，页面侧用的也是它
const indexableTags = new Set(
  tagIndex(webDb)
    .filter((tag) => isIndexableCollection(tag.count))
    .map((tag) => tag.slug),
);

// 薄期页同理：日报必然有「今天只来了一篇」的日子，它们 noindex、也不进 sitemap
const indexableEditions = new Set(
  editionSummaries(webDb)
    .filter((row) => isIndexableCollection(row.count))
    .map((row) => row.number),
);

// https://astro.build/config
// 样式表保持外链（不设 build.inlineStylesheets: "always"）：本站是几百个静态页共享
// 同一批 CSS，外链可跨页缓存；内联会让每页 HTML 各带一份，搜索引擎爬取白白变大。
export default defineConfig({
  site: "https://boguan.org.cn",
  outDir: process.env.BOGUAN_OUT_DIR ?? "./dist",
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
  vite: {
    build: {
      rollupOptions: {
        external: [/@node-rs\/jieba/],
      },
    },
  },
  integrations: [
    sitemap({
      // 键是 URL 里的语言段，值是 hreflang；默认语言没有前缀，但也要出现在映射里，
      // 否则 `/` 与 `/en/` 无法互相关联（见 ARCHITECTURE §8）。
      i18n: {
        defaultLocale: "zh-CN",
        locales: { "zh-CN": "zh-CN", en: "en" },
      },
      // 搜索页、筛选组合页、薄标签页、薄期页都是 noindex，不进 sitemap
      filter: (page) => {
        const path = new URL(page).pathname;
        if (/(^|\/)search\/?$/.test(path)) return false;
        const edition = path.match(/\/(?:en\/)?edition\/(\d+)/);
        if (edition) return indexableEditions.has(Number(edition[1]));
        const tag = path.match(/\/(?:en\/)?tag\/([^/]+)/);
        return tag ? indexableTags.has(tag[1]) : true;
      },
    }),
  ],
});
