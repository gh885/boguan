import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repo = fileURLToPath(new URL(".", import.meta.url));
const roots = ["src", "scripts", "apps", "packages"];

const sourceFile = /\.(ts|astro|mjs)$/;

function walk(root: string): string[] {
  const dir = join(repo, root);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((name) => !name.includes("node_modules"))
    .filter((name) => sourceFile.test(name) && !name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

const files = roots.flatMap(walk);

const id = (path: string): string => relative(repo, path).replaceAll("\\", "/");

function importsOf(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

const isUi = (path: string): boolean => /(pages|components|layouts)[\\/]/.test(path);

describe("包边界", () => {
  it("扫描到了实际源码", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("页面、组件、layout 只经 database/web-read 读库", () => {
    const offenders = files.filter(isUi).flatMap((path) =>
      importsOf(path)
        .filter(
          (specifier) =>
            specifier.includes("database") && specifier !== "@boguan/database/web-read",
        )
        .map((specifier) => `${id(path)} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("正文存储只有 crawler 与 ops 能引用", () => {
    const allowed = new Set([
      "scripts/crawler/pipeline.ts",
      "apps/crawler/src/pipeline.ts",
      "apps/ops/src/check.ts",
      "apps/ops/src/curate-lib.ts",
      "apps/ops/src/metrics.ts",
    ]);

    const offenders = files
      .filter((path) => importsOf(path).some((specifier) => specifier === "@boguan/body-store"))
      .map(id)
      .filter((path) => !allowed.has(path));

    expect(offenders).toEqual([]);
  });

  it("FTS 的 token 列只在 database 包里出现", () => {
    const offenders = files
      .filter((path) => !id(path).startsWith("packages/database/"))
      .filter((path) => /body_tokens|title_tokens/.test(readFileSync(path, "utf8")))
      .map(id);

    expect(offenders).toEqual([]);
  });

  it("抓取与运维代码不引用渲染层", () => {
    const offenders = files
      .filter(
        (path) => /(^|\/)(crawler|ops)[\\/]/.test(id(path)) || id(path).startsWith("scripts/"),
      )
      .flatMap((path) =>
        importsOf(path)
          .filter((specifier) => /(src\/(pages|components|layouts)|apps\/web)/.test(specifier))
          .map((specifier) => `${id(path)} → ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it("包只经公开入口被引用", () => {
    const allowed = /^@boguan\/[a-z-]+(\/[a-z-]+)?$/;

    const offenders = files.flatMap((path) =>
      importsOf(path)
        .filter((specifier) => specifier.startsWith("@boguan/"))
        .filter((specifier) => !allowed.test(specifier))
        .map((specifier) => `${id(path)} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});
