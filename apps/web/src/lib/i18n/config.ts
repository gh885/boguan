export const locales = ["zh-CN", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export const localePathSegments: Record<Locale, string> = {
  "zh-CN": "zh-cn",
  en: "en",
};

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "中文",
  en: "English",
};

export const ogLocales: Record<Locale, string> = {
  "zh-CN": "zh_CN",
  en: "en_US",
};

export const displayTimeZone = "Asia/Shanghai";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function pathSegment(locale: Locale): string {
  return locale === defaultLocale ? "" : localePathSegments[locale];
}
