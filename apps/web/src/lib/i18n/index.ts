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

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const value = messages[locale][key] ?? messages[defaultLocale][key];
  if (value === undefined) {
    throw new Error(`Missing message "${key}" in locale "${locale}"`);
  }
  return interpolate(value, params);
}

export function useTranslations(locale: Locale) {
  return (key: MessageKey, params?: MessageParams): string => translate(locale, key, params);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

export type CountUnit = "articles" | "companies" | "tags";

export function formatCount(locale: Locale, unit: CountUnit, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const form = rules.select(count) === "one" ? "one" : "other";

  if (unit === "articles") {
    return form === "one"
      ? translate(locale, "count.articles.one", { count })
      : translate(locale, "count.articles.other", { count });
  }
  if (unit === "companies") {
    return form === "one"
      ? translate(locale, "count.companies.one", { count })
      : translate(locale, "count.companies.other", { count });
  }
  return form === "one"
    ? translate(locale, "count.tags.one", { count })
    : translate(locale, "count.tags.other", { count });
}

const listFormatters = new Map<Locale, Intl.ListFormat>();

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

const longDateFormatters = new Map<Locale, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<Locale, Intl.DateTimeFormat>();

export function formatLongDate(value: Date | string, locale: Locale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  let dateFormatter = longDateFormatters.get(locale);
  if (!dateFormatter) {
    dateFormatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: displayTimeZone,
    });
    longDateFormatters.set(locale, dateFormatter);
  }
  let weekdayFormatter = weekdayFormatters.get(locale);
  if (!weekdayFormatter) {
    weekdayFormatter = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone: displayTimeZone,
    });
    weekdayFormatters.set(locale, weekdayFormatter);
  }
  return `${dateFormatter.format(date)} · ${weekdayFormatter.format(date)}`;
}

const monthFormatters = new Map<Locale, Intl.DateTimeFormat>();

export function formatMonth(dayKey: string, locale: Locale): string {
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      timeZone: displayTimeZone,
    });
    monthFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${dayKey}T00:00:00.000Z`));
}

const numberFormatters = new Map<Locale, Intl.NumberFormat>();

export function formatNumber(locale: Locale, value: number): string {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}

function ensureLeadingSlash(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function localizePath(pathname: string, locale: Locale): string {
  const path = ensureLeadingSlash(pathname);
  const segment = pathSegment(locale);
  if (segment === "") return path;
  return path === "/" ? `/${segment}/` : `/${segment}${path}`;
}

export function localeFromPathname(pathname: string): Locale {
  const [first = ""] = pathname.replace(/^\/+/, "").split("/");
  const segment = first.toLowerCase();
  const match = locales.find(
    (locale) => locale !== defaultLocale && localePathSegments[locale] === segment,
  );
  return match ?? defaultLocale;
}

export function stripLocale(pathname: string): string {
  const locale = localeFromPathname(pathname);
  const segment = pathSegment(locale);
  if (segment === "") return ensureLeadingSlash(pathname);
  const rest = pathname.replace(/^\/+/, "").slice(segment.length);
  return ensureLeadingSlash(rest);
}

export interface AlternateLink {
  locale: Locale;
  href: string;
  hreflang: string;
}

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

export type RouteParams = Record<string, string | number | undefined>;

export interface LocaleRoute {
  params: RouteParams;
  props: { locale: Locale };
}

export function localeRoutes(
  params: RouteParams = {},
  languages: readonly Locale[] = locales,
): LocaleRoute[] {
  return languages.map((locale) => ({
    params: { ...params, lang: locale === defaultLocale ? undefined : pathSegment(locale) },
    props: { locale },
  }));
}
