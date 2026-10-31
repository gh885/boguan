import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/**
 * 边界守卫（docs/ARCHITECTURE.md §2）。
 *
 * 「正文不落到页面上」这条规则只靠注释不够——这里把它变成会失败的测试：
 * 1. 页面/组件/layout 只能通过 `src/lib/db/queries/` 读库，不能直接开连接；
 * 2. 正文存储（`bodies.ts`）只有 crawler 与它自己的可以引用；
 * 3. FTS 的 token 列只在写入侧出现，页面侧碰不到，也就没法把正文拼出来；
 * 4. crawler 不许 import 任何 Astro 代码。
 *
 * 改这条测试之前先想清楚：放宽它就是放宽硬性规则 1。
 */

const srcDir = fileURLToPath(new URL("../../", import.meta.url));
const repoDir = fileURLToPath(new URL("../../../", import.meta.url));

function walk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    const path = join(root, name);
    if (!/\.(ts|astro|mjs)$/.test(name)) continue;
    if (name.endsWith(".test.ts")) continue;
    out.push(path);
  }
  return out;
}

const srcFiles = walk(srcDir);
const scriptFiles = walk(join(repoDir, "scripts"));

function relativeToRepo(path: string): string {
  return relative(repoDir, path).replaceAll("\\", "/");
}

describe("进程边界", () => {
  it("页面、组件、layout 不许绕过 queries 直接开库", () => {
    const uiFiles = srcFiles.filter((path) => /(pages|components|layouts)[\\/]/.test(path));
    expect(uiFiles.length).toBeGreaterThan(0);

    for (const path of uiFiles) {
      const text = readFileSync(path, "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of imports) {
        if (!specifier.includes("/db")) continue;
        expect(
          /db\/queries(\/|$)/.test(specifier),
          `${relativeToRepo(path)} 直接引用了 ${specifier}，页面只能经 src/lib/db/queries 读库`,
        ).toBe(true);
      }
    }
  });

  it("正文存储只有 crawler 能引用", () => {
    const allowed = new Set(["scripts/crawler/pipeline.ts", "scripts/db/check.ts"]);
    const offenders = [...srcFiles, ...scriptFiles]
      .filter((path) => /from\s+["'][^"']*db\/bodies["']/.test(readFileSync(path, "utf8")))
      .map(relativeToRepo)
      .filter((path) => !allowed.has(path) && !path.startsWith("src/lib/db/bodies"));

    expect(offenders, "正文文件只给 crawler 用，web 侧不该有访问路径").toEqual([]);
  });

  it("FTS 的 token 列只在写入/建表处出现", () => {
    const allowed = new Set([
      "src/lib/db/fts.ts",
      "src/lib/db/schema.ts",
      "src/lib/db/queries/search.ts", // 只用 title_tokens 做列过滤，不读 body
    ]);
    const offenders: string[] = [];

    for (const path of srcFiles) {
      const relativePath = relativeToRepo(path);
      const text = readFileSync(path, "utf8");
      if (
        /body_tokens/.test(text) &&
        relativePath !== "src/lib/db/fts.ts" &&
        relativePath !== "src/lib/db/schema.ts"
      ) {
        offenders.push(`${relativePath}（body_tokens）`);
      }
      if (/title_tokens/.test(text) && !allowed.has(relativePath)) {
        offenders.push(`${relativePath}（title_tokens）`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("crawler 不许 import Astro 代码", () => {
    for (const path of scriptFiles) {
      const text = readFileSync(path, "utf8");
      for (const specifier of [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])) {
        const target = specifier.replace(/\\/g, "/");
        expect(
          /src\/(pages|components|layouts)\//.test(target),
          `${relativeToRepo(path)} import 了 Astro 代码：${target}`,
        ).toBe(false);
      }
    }
  });
});
