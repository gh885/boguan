import { describe, expect, it } from "vite-plus/test";
import en from "./messages/en.json";
import zhCN from "./messages/zh-CN.json";
import {
  alternateLinks,
  formatCount,
  formatDate,
  formatList,
  formatLongDate,
  formatNumber,
  localizePath,
  localeFromPathname,
  localeRoutes,
  stripLocale,
  translate,
  useTranslations,
} from "./index";
import { companyDisplayName } from "./company";

describe("messages", () => {
  it("每个语言都有同一套 key", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("没有空文案", () => {
    for (const [key, value] of Object.entries({ ...zhCN, ...en })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("占位符在各语言间一致", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zhCN[key]));
    }
  });
});

describe("translate", () => {
  it("按语言取词", () => {
    expect(translate("zh-CN", "nav.language")).toBe("语言");
    expect(translate("en", "nav.language")).toBe("Language");
  });

  it("替换占位符", () => {
    expect(translate("en", "language.switchTo", { language: "中文" })).toBe("Switch to 中文");
  });

  it("缺少参数时保留原占位符", () => {
    expect(translate("en", "language.switchTo")).toBe("Switch to {language}");
  });

  it("useTranslations 绑定语言", () => {
    const t = useTranslations("en");
    expect(t("nav.language")).toBe("Language");
  });
});

describe("localizePath", () => {
  it("默认语言不加前缀", () => {
    expect(localizePath("/", "zh-CN")).toBe("/");
    expect(localizePath("/company/meituan", "zh-CN")).toBe("/company/meituan");
  });

  it("其它语言加前缀", () => {
    expect(localizePath("/", "en")).toBe("/en/");
    expect(localizePath("/company/meituan", "en")).toBe("/en/company/meituan");
    expect(localizePath("company/meituan", "en")).toBe("/en/company/meituan");
  });
});

describe("localeFromPathname", () => {
  it("认出语言前缀", () => {
    expect(localeFromPathname("/")).toBe("zh-CN");
    expect(localeFromPathname("/en/")).toBe("en");
    expect(localeFromPathname("/en/company/meituan")).toBe("en");
  });

  it("不把普通路径当成语言", () => {
    expect(localeFromPathname("/energy")).toBe("zh-CN");
    expect(localeFromPathname("/en")).toBe("en");
    expect(localeFromPathname("/company/en")).toBe("zh-CN");
  });
});

describe("stripLocale / alternateLinks", () => {
  it("去掉前缀", () => {
    expect(stripLocale("/")).toBe("/");
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/en/")).toBe("/");
    expect(stripLocale("/en/company/meituan")).toBe("/company/meituan");
    expect(stripLocale("/company/meituan")).toBe("/company/meituan");
  });

  it("生成各语言地址与 hreflang", () => {
    expect(alternateLinks("/en/company/meituan")).toEqual([
      { locale: "zh-CN", href: "/company/meituan", hreflang: "zh-CN" },
      { locale: "en", href: "/en/company/meituan", hreflang: "en" },
    ]);
  });

  it("默认语言与其它语言互相还原", () => {
    const links = alternateLinks("/");
    expect(links.map((link) => stripLocale(link.href))).toEqual(["/", "/"]);
  });
});

describe("formatCount / formatList", () => {
  it("英文单复数与中文量词", () => {
    expect(formatCount("en", "articles", 1)).toBe("1 article");
    expect(formatCount("en", "articles", 2)).toBe("2 articles");
    expect(formatCount("zh-CN", "articles", 2)).toBe("2 篇文章");
  });

  it("公司名在英文界面优先用 nameEn", () => {
    expect(companyDisplayName({ name: "美团", nameEn: "Meituan" }, "en")).toBe("Meituan");
    expect(companyDisplayName({ name: "美团", nameEn: "Meituan" }, "zh-CN")).toBe("美团");
    expect(companyDisplayName({ name: "美团", nameEn: null }, "en")).toBe("美团");
  });

  it("列表连接符跟随语言", () => {
    expect(formatList("en", ["A", "B", "C"])).toContain("and");
    expect(formatList("zh-CN", ["A", "B", "C"])).toContain("、");
  });
});

describe("formatDate", () => {
  it("按北京时间展示", () => {
    // UTC 2024-01-01 20:00 → 北京时间 2024-01-02
    const date = "2024-01-01T20:00:00.000Z";
    expect(formatDate(date, "zh-CN")).toContain("2024");
    expect(formatDate(date, "zh-CN")).toContain("2");
    expect(formatDate(date, "en")).toContain("2024");
  });
});

describe("formatLongDate / formatNumber", () => {
  it("刊头日期同时给出日期与星期", () => {
    // UTC 2024-01-01 20:00 → 北京时间 2024-01-02，星期二
    const date = "2024-01-01T20:00:00.000Z";
    expect(formatLongDate(date, "zh-CN")).toContain("星期二");
    expect(formatLongDate(date, "zh-CN")).toContain("·");
    expect(formatLongDate(date, "en")).toContain("Tuesday");
  });

  it("期号数字跟随语言分组", () => {
    expect(formatNumber("zh-CN", 12345)).toBe("12,345");
    expect(formatNumber("en", 12345)).toBe("12,345");
  });
});

describe("localeRoutes", () => {
  it("默认语言不带前缀，其它语言带前缀", () => {
    expect(localeRoutes()).toEqual([
      { params: { lang: undefined }, props: { locale: "zh-CN" } },
      { params: { lang: "en" }, props: { locale: "en" } },
    ]);
  });

  it("带上动态段", () => {
    expect(localeRoutes({ slug: "meituan" })).toEqual([
      { params: { slug: "meituan", lang: undefined }, props: { locale: "zh-CN" } },
      { params: { slug: "meituan", lang: "en" }, props: { locale: "en" } },
    ]);
  });

  it("生成的路径能被 alternateLinks 还原", () => {
    for (const route of localeRoutes({ slug: "meituan" })) {
      const pathname = localizePath("/company/meituan", route.props.locale);
      expect(localeFromPathname(pathname)).toBe(route.props.locale);
      expect(alternateLinks(pathname)).toHaveLength(2);
    }
  });
});

describe("alternateLinks 收窄到实际生成的语言", () => {
  it("只生成中文时不输出 en 的 hreflang", () => {
    expect(alternateLinks("/topic/x", ["zh-CN"])).toEqual([
      { locale: "zh-CN", href: "/topic/x", hreflang: "zh-CN" },
    ]);
  });
});

describe("页面目录约定", () => {
  it("所有页面都在 src/pages/[...lang]/ 下，避免漏生成某种语言", () => {
    const pages = Object.keys(import.meta.glob("/src/pages/**/*.astro"));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((file) => !file.startsWith("/src/pages/[...lang]/"))).toEqual([]);
  });
});
