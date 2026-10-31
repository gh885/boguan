import { describe, expect, it } from "vite-plus/test";
import { parsePublishedAt, yearInTimeZone, zonedToUtc } from "./date";
import { normalizeRawTag, normalizeRawTags } from "./tag";
import {
  collapseWhitespace,
  decodeEntities,
  stripHtml,
  SUMMARY_MAX,
  truncateSummary,
} from "./text";
import { slugify, titleNorm } from "./title";
import { canonicalizeUrl, hostOf } from "./url";

describe("canonicalizeUrl", () => {
  it("去掉追踪参数、锚点与末尾斜杠", () => {
    expect(
      canonicalizeUrl("https://tech.meituan.com/2026/10/29/x.html?utm_source=wx&from=timeline#top"),
    ).toBe("https://tech.meituan.com/2026/10/29/x.html");
  });

  it("相对链接按 base 补成绝对地址", () => {
    expect(canonicalizeUrl("/spark-app/", "https://tech.youzan.com/")).toBe(
      "https://tech.youzan.com/spark-app",
    );
  });

  it("保留有语义的 query，参数顺序归一", () => {
    expect(canonicalizeUrl("https://a.com/p?id=2&tab=1")).toBe("https://a.com/p?id=2&tab=1");
    expect(canonicalizeUrl("https://a.com/p?tab=1&id=2")).toBe("https://a.com/p?id=2&tab=1");
  });

  it("根路径的斜杠保留，非 http(s) 返回 null", () => {
    expect(canonicalizeUrl("https://a.com/")).toBe("https://a.com/");
    expect(canonicalizeUrl("mailto:hi@a.com")).toBeNull();
    expect(canonicalizeUrl("javascript:void(0)")).toBeNull();
  });

  it("不跨域改协议（http 不擅自升 https）", () => {
    expect(canonicalizeUrl("http://a.com/p")).toBe("http://a.com/p");
  });

  it("hostOf 提取串行作用域", () => {
    expect(hostOf("https://tech.youzan.com/a")).toBe("tech.youzan.com");
    expect(hostOf("nonsense")).toBeNull();
  });
});

describe("parsePublishedAt", () => {
  it("带时区偏移的串按偏移解析", () => {
    expect(parsePublishedAt("Thu, 29 Oct 2026 07:43:52 GMT")).toBe("2026-10-29T07:43:52.000Z");
    expect(parsePublishedAt("2026-10-29T10:00:00+08:00")).toBe("2026-10-29T02:00:00.000Z");
  });

  it("无时区的串按源站时区解释（有赞的 `28 Oct 2022`）", () => {
    expect(parsePublishedAt("28 Oct 2022", "Asia/Shanghai")).toBe("2022-10-27T16:00:00.000Z");
    expect(parsePublishedAt("2022年10月28日 09:30", "Asia/Shanghai")).toBe(
      "2022-10-28T01:30:00.000Z",
    );
  });

  it("按源站时区切年：UTC 还是 2023 时，北京已经是 2024", () => {
    const iso = parsePublishedAt("2023-12-31 20:30", "Asia/Shanghai");
    expect(iso).toBe("2023-12-31T12:30:00.000Z");
    expect(yearInTimeZone(iso, "Asia/Shanghai")).toBe(2023);
    expect(yearInTimeZone("2023-12-31T16:30:00.000Z", "Asia/Shanghai")).toBe(2024);
    expect(yearInTimeZone("2023-12-31T16:30:00.000Z", "UTC")).toBe(2023);
  });

  it("跨夏令时的时区也能算对", () => {
    expect(parsePublishedAt("2024-03-10 12:00", "America/Los_Angeles")).toBe(
      "2024-03-10T19:00:00.000Z",
    );
    expect(
      zonedToUtc(
        { year: 2024, month: 7, day: 1, hour: 12, minute: 0, second: 0 },
        "America/Los_Angeles",
      ),
    ).toBe(Date.UTC(2024, 6, 1, 19, 0, 0));
  });

  it("解析不出来就返回 null，不编造", () => {
    for (const raw of ["", "   ", "昨天", "2023", "2023-13-01", "31 Feb 2023", "0000-00-00"]) {
      expect(parsePublishedAt(raw), raw).toBeNull();
    }
  });

  it("yearInTimeZone 对空值与非法值返回 null", () => {
    expect(yearInTimeZone(null)).toBeNull();
    expect(yearInTimeZone("not-a-date")).toBeNull();
  });
});

describe("文本归一", () => {
  it("解实体 + 去标签 + 折叠空白", () => {
    expect(stripHtml("<p>知识&amp;图谱</p><br/>　　第二段&hellip;</p>")).toBe("知识&图谱 第二段…");
    expect(decodeEntities("&#20013;&#x6587;")).toBe("中文");
    // 零宽字符直接删掉，不制造空格（避免把词拆开）
    expect(collapseWhitespace("a\u3000b\u200bc\n")).toBe("a bc");
  });

  it("摘要不超过上限，且尽量在句末收口", () => {
    const long = "第一句话讲背景。".repeat(25);
    const summary = truncateSummary(long);
    expect(Array.from(summary).length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(summary.endsWith("。")).toBe(true);
  });

  it("短文本原样返回，超长硬切也不超过上限", () => {
    expect(truncateSummary("很短的一句话")).toBe("很短的一句话");
    const noPunctuation = "字".repeat(500);
    expect(Array.from(truncateSummary(noPunctuation)).length).toBe(SUMMARY_MAX);
  });

  it("按码点计数，emoji 不会让长度翻倍", () => {
    const text = "🚀".repeat(300);
    expect(Array.from(truncateSummary(text)).length).toBe(SUMMARY_MAX);
  });
});

describe("标题与标签归一", () => {
  it("标题归一吃掉标点、空格与全半角差异", () => {
    expect(titleNorm("如何在“不能出错”的系统里使用 AI Coding？")).toBe(
      titleNorm("如何在不能出错的系统里使用AI Coding"),
    );
  });

  it("slugify 只产出 ASCII，中文返回 null 交给人工", () => {
    expect(slugify("Big Data")).toBe("big-data");
    expect(slugify("C++")).toBe("c");
    expect(slugify("C++ 优化")).toBeNull();
    expect(slugify("大数据")).toBeNull();
  });

  it("源站标签归一后去重", () => {
    expect(normalizeRawTags(["Big Data", "#big data", "  ", "Big Data"])).toEqual(["big data"]);
    expect(normalizeRawTag("＃大数据")).toBe("大数据");
  });
});
