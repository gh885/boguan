// @ts-check
import { editionSummaries, openWebDatabase, tagIndex } from "@boguan/database/web-read";
import { isIndexableCollection } from "@boguan/domain";
import sitemap from "@astrojs/sitemap";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import { defaultLocale, locales } from "./src/lib/i18n/config";
import { site } from "./src/lib/site";

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
  site: site.url,
  outDir: process.env.BOGUAN_OUT_DIR ?? "./dist",
  i18n: {
    defaultLocale,
    locales: [...locales],
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
        defaultLocale,
        locales: Object.fromEntries(locales.map((locale) => [locale, locale])),
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
