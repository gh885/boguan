// @ts-check
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
});
