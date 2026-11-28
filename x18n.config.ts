import { defineConfig } from "@x18n/core";

export default defineConfig({
  sourceLocale: "zh-CN",
  presets: ["general"],
  resources: [{ pattern: "apps/web/src/lib/i18n/messages/{locale}.json" }],
  usage: {
    calls: [
      { callee: "useTranslations", factory: true, returns: ["t"] },
      { callee: "t" },
      { callee: "translate", key: { arg: 1 } },
    ],
    keysInUse: ["nav.skipToContent"],
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
