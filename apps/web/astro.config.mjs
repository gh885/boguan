// @ts-check
import { editionSummaries, openWebDatabase, tagIndex } from "@boguan/database/web-read";
import { isIndexableCollection } from "@boguan/domain";
import sitemap from "@astrojs/sitemap";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

const webDb = openWebDatabase();

const indexableTags = new Set(
  tagIndex(webDb)
    .filter((tag) => isIndexableCollection(tag.count))
    .map((tag) => tag.slug),
);

const indexableEditions = new Set(
  editionSummaries(webDb)
    .filter((row) => isIndexableCollection(row.count))
    .map((row) => row.number),
);

export default defineConfig({
  site: "https://boguan.org.cn",
  outDir: process.env.BOGUAN_OUT_DIR ?? "./dist",
  i18n: {
    defaultLocale: "zh-CN",
    locales: ["zh-CN", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
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
      i18n: {
        defaultLocale: "zh-CN",
        locales: { "zh-CN": "zh-CN", en: "en" },
      },
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
