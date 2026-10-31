import {
  defaultLocale,
  displayTimeZone,
  localePathSegments,
  locales,
  type Locale,
  pathSegment,
} from "./config";
import en from "./messages/en.json";
import zhCN from "./messages/zh-CN.json";

export { isLocale, localeLabels, resolveLocale } from "./config";
export type { Locale } from "./config";

/**
 * 界面文案的唯一来源。key 用扁平的 `area.name` 写法，与 x18n 的 key 推断一致。
 * 新增 key 先写 `messages/zh-CN.json`（源语言），再补 `en.json`；
 * `vp run i18n:check` 与 `messages.test.ts` 会拦住漏翻和多余。
 */
export type MessageKey = keyof typeof zhCN;

export type MessageParams = Record<string, string | number>;

const messages: Record<Locale, Partial<Record<MessageKey, string>>> = {
  "zh-CN": zhCN,
  en: en,
};

const placeholderPattern = /\{(\w+)\}/g;

function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) return template;
  return template.replace(placeholderPattern, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 取一条文案。当前语言缺 key 时回退到默认语言；两边都没有就直接抛错，
 * 让构建失败，而不是把 key 渲染到页面上。
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const value = messages[locale][key] ?? messages[defaultLocale][key];
  if (value === undefined) {
    throw new Error(`Missing message "${key}" in locale "${locale}"`);
  }
  return interpolate(value, params);
}

/**
 * 页面里实际的取词方式。x18n 通过 `usage.calls` 里的 `factory` 规则识别 `t('key')`。
 *
 * ```astro
 * const t = useTranslations(locale);
 * <h1>{t("home.building.title")}</h1>
 * ```
 */
export function useTranslations(locale: Locale) {
  return (key: MessageKey, params?: MessageParams): string => translate(locale, key, params);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** 英文单复数走 Intl.PluralRules；中文两种形式文案相同，读起来也自然。 */
export type CountUnit = "articles" | "companies" | "tags";

export function formatCount(locale: Locale, unit: CountUnit, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const form = rules.select(count) === "one" ? "one" : "other";
  const key = `count.${unit}.${form}` as MessageKey;
  return translate(locale, key, { count });
}

const listFormatters = new Map<Locale, Intl.ListFormat>();

/** 把公司名/标签名连成一句；中文顿号、英文牛津逗号交给 Intl。 */
export function formatList(locale: Locale, items: readonly string[]): string {
  if (items.length === 0) return "";
  let formatter = listFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listFormatters.set(locale, formatter);
  }
  return formatter.format(items);
}

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** 入库时间是 UTC，展示一律按北京时间。 */
export function formatDate(value: Date | string, locale: Locale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: displayTimeZone,
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

function ensureLeadingSlash(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** 给站内路径加上语言前缀：`/company/meituan` → `/en/company/meituan`（默认语言原样返回）。 */
export function localizePath(pathname: string, locale: Locale): string {
  const path = ensureLeadingSlash(pathname);
  const segment = pathSegment(locale);
  if (segment === "") return path;
  return path === "/" ? `/${segment}/` : `/${segment}${path}`;
}

/** 从 pathname 判断语言；只认配置过的、且不是默认语言的前缀段。 */
export function localeFromPathname(pathname: string): Locale {
  const [first = ""] = pathname.replace(/^\/+/, "").split("/");
  const segment = first.toLowerCase();
  const match = locales.find(
    (locale) => locale !== defaultLocale && localePathSegments[locale] === segment,
  );
  return match ?? defaultLocale;
}

/** 去掉语言前缀，得到与语言无关的站内路径。 */
export function stripLocale(pathname: string): string {
  const locale = localeFromPathname(pathname);
  const segment = pathSegment(locale);
  if (segment === "") return ensureLeadingSlash(pathname);
  const rest = pathname.replace(/^\/+/, "").slice(segment.length);
  return ensureLeadingSlash(rest);
}

export interface AlternateLink {
  locale: Locale;
  /** 站内相对路径，带该语言的前缀。 */
  href: string;
  /** 直接可用于 `<link rel="alternate" hreflang>`。 */
  hreflang: string;
}

/**
 * 同一份内容的各语言地址。slug 与语言无关，因此只需替换前缀，
 * 页面里不用手写 hreflang 列表。
 *
 * `available` 是本页真正生成过的语言：只生成部分语言时传进来，
 * 避免 hreflang 指向不存在的页面。
 */
export function alternateLinks(
  pathname: string,
  available: readonly Locale[] = locales,
): AlternateLink[] {
  const base = stripLocale(pathname);
  return available.map((locale) => ({
    locale,
    href: localizePath(base, locale),
    hreflang: locale,
  }));
}

/** `getStaticPaths()` 的 params：值只能是字符串、数字或 undefined。 */
export type RouteParams = Record<string, string | number | undefined>;

export interface LocaleRoute {
  params: RouteParams;
  props: { locale: Locale };
}

/**
 * 一条页面路由 × 所有语言。页面只写一份，语言作为数据：
 *
 * ```astro
 * export const getStaticPaths = (() => localeRoutes()) satisfies GetStaticPaths;
 * // 带动态段时传进去，例如 localeRoutes({ slug: company.slug })
 * ```
 *
 * 默认语言用 `lang: undefined` 生成不带前缀的路径（`/`、`/company/meituan`），
 * 其它语言生成带前缀的路径（`/en/`、`/en/company/meituan`），
 * 正好对得上 `prefixDefaultLocale: false`。
 */
export function localeRoutes(
  params: RouteParams = {},
  languages: readonly Locale[] = locales,
): LocaleRoute[] {
  return languages.map((locale) => ({
    params: { ...params, lang: locale === defaultLocale ? undefined : pathSegment(locale) },
    props: { locale },
  }));
}
