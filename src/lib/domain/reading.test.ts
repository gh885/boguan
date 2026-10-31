import { describe, expect, it } from "vite-plus/test";
import { hasCodeInHtml, looksLikeCode } from "./code";
import { readingMinutes } from "./reading";
import { groupTags, tagGroupOf } from "./tag-group";

describe("阅读时长", () => {
  it("中文按 400 字/分钟，英文按 200 词/分钟，至少 1 分钟", () => {
    expect(readingMinutes("")).toBeNull();
    expect(readingMinutes("   ")).toBeNull();
    expect(readingMinutes("字".repeat(400))).toBe(1);
    expect(readingMinutes("字".repeat(401))).toBe(2);
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
  });

  it("中英混排分别计数后相加", () => {
    expect(readingMinutes(`${"字".repeat(400)} ${"word ".repeat(200)}`)).toBe(2);
  });
});

describe("代码块检测", () => {
  it("HTML 里出现 pre 或 code 就算包含代码", () => {
    expect(hasCodeInHtml("<p>正文</p><pre><code>x</code></pre>")).toBe(true);
    expect(hasCodeInHtml("<p>行内 <code>npm i</code></p>")).toBe(true);
    expect(hasCodeInHtml("<p>只有正文</p>")).toBe(false);
  });

  it("纯文本回填只认多行代码特征，不把散文括号当代码", () => {
    expect(looksLikeCode("这是一段正常的文章。\n它有两行。\n没有代码。")).toBe(false);
    expect(looksLikeCode("const a = 1;\nfunction f() {\n  return a;\n}\nexport default f;")).toBe(
      true,
    );
  });
});

describe("标签分组", () => {
  it("已知标签进对应组，未知标签落到其他", () => {
    expect(tagGroupOf("ai")).toBe("ai");
    expect(tagGroupOf("big-data")).toBe("data");
    expect(tagGroupOf("not-mapped-yet")).toBe("other");
  });

  it("空组不出现，组内保持输入顺序", () => {
    const groups = groupTags([
      { slug: "ai", name: "人工智能", count: 8 },
      { slug: "big-data", name: "大数据", count: 6 },
      { slug: "not-mapped-yet", name: "新标签", count: 1 },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["ai", "data", "other"]);
    expect(groups[0]?.tags.map((tag) => tag.slug)).toEqual(["ai"]);
  });
});
