import { defineConfig } from "@x18n/core";

/**
 * x18n 只做校验与管理，不参与运行时；运行时取词在 src/lib/i18n。
 * 用法：`vp run i18n:check`（CI 会跑），`vp run i18n:ui` 起可视化编辑界面。
 */
export default defineConfig({
  sourceLocale: "zh-CN",
  presets: ["general"],
  resources: [{ pattern: "src/lib/i18n/messages/{locale}.json" }],
  usage: {
    calls: [
      // const t = useTranslations(locale); t('key')
      { callee: "useTranslations", factory: true, returns: ["t"] },
      // .astro 模板里的 t('key') 与 frontmatter 不在同一段 AST，需要单独登记
      { callee: "t" },
      // translate(locale, 'key')
      { callee: "translate", key: { arg: 1 } },
    ],
  },
  write: {
    sort: "binary",
    indent: 2,
  },
  checks: {
    "missing-key": "error",
    "missing-translation": "error",
    "unused-key": "warning",
  },
});
