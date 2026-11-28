/**
 * 语言清单与语言相关的常量。新增语言只需要改这里 + 加一份 messages 文件。
 *
 * 约定：
 * - locale 代码用 BCP 47 写法（`zh-CN`、`en`），与 `lang` / `hreflang` 一致。
 * - URL 前缀只用小写段（见 `localePathSegments`），默认语言不带前缀。
 */

export const locales = ["zh-CN", "en"] as const;

export type Locale = (typeof locales)[number];

/** 源语言：文案以此为准，其它语言缺词时回退到这里。 */
export const defaultLocale: Locale = "zh-CN";

/** 出现在 URL 里的语言段，默认语言的 `pathSegment` 永远为空。 */
export const localePathSegments: Record<Locale, string> = {
  "zh-CN": "zh-cn",
  en: "en",
};

/** 语言切换器里显示的名称，一律用该语言自己的写法（endonym）。 */
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "中文",
  en: "English",
};

/** Open Graph 的 `og:locale` 用下划线写法。 */
export const ogLocales: Record<Locale, string> = {
  "zh-CN": "zh_CN",
  en: "en_US",
};

/** 所有展示时间统一按北京时间格式化，存储仍是 UTC。 */
export const displayTimeZone = "Asia/Shanghai";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** 把 `Astro.currentLocale` 这类外部值收窄成已知语言，未知则退回默认语言。 */
export function resolveLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

/** 语言在 URL 中的前缀段；默认语言为空串。 */
export function pathSegment(locale: Locale): string {
  return locale === defaultLocale ? "" : localePathSegments[locale];
}
