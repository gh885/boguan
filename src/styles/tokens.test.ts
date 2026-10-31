import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/**
 * 设计令牌的守卫：色板是否仍在 sRGB 内、每个角色两套值是否齐全、
 * 语义色是否只有一套切换机制、以及实测对比度是否达标。
 *
 * 改颜色后跑 `vp test`；失败就是真的不达标，不要放宽阈值。
 */

const stylesDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = fileURLToPath(new URL("..", import.meta.url));

const tokenCss = readFileSync(join(stylesDir, "tokens.css"), "utf8");

/** 组件与全局样式，用来检查它们引用的颜色令牌是否真的存在 */
const allCss: Record<string, string> = {};
for (const file of readdirSync(srcDir, { recursive: true })) {
  const path = String(file);
  if (!path.endsWith(".css") && !path.endsWith(".astro")) continue;
  allCss[relative(srcDir, join(srcDir, path))] = readFileSync(join(srcDir, path), "utf8");
}

type Oklch = readonly [number, number, number];

function parseOklch(value: string): Oklch {
  const numbers = value
    .replace(/^oklch\(/, "")
    .replace(/\)$/, "")
    .trim()
    .split(/\s+/)
    .map(Number);
  const [l, c, h] = numbers;
  if (l === undefined || c === undefined || h === undefined) {
    throw new Error(`Cannot parse oklch value：${value}`);
  }
  return [l, c, h];
}

/** oklch → 线性 sRGB */
function toLinearRgb([l, c, h]: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

const luminance = ([r, g, b]: readonly [number, number, number]) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(toLinearRgb(a)), luminance(toLinearRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 去掉注释再匹配，否则注释里提到的写法会被当成真实代码 */
const flat = tokenCss.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

const primitives = new Map<string, Oklch>();
for (const match of flat.matchAll(/--([a-z0-9-]+): (oklch\([^)]*\))/g)) {
  primitives.set(match[1]!, parseOklch(match[2]!));
}

const semantic = new Map<string, { light: string; dark: string }>();
for (const match of flat.matchAll(
  /--color-([a-z-]+): light-dark\(var\(--([a-z0-9-]+)\), var\(--([a-z0-9-]+)\)\)/g,
)) {
  semantic.set(match[1]!, { light: match[2]!, dark: match[3]! });
}

function color(role: string, scheme: "light" | "dark"): Oklch {
  const token = semantic.get(role);
  if (!token) throw new Error(`Missing semantic color: --color-${role}`);
  const value = primitives.get(token[scheme]);
  if (!value) throw new Error(`Missing primitive: --${token[scheme]}`);
  return value;
}

describe("设计令牌", () => {
  it("每个角色都有亮/暗两套值", () => {
    expect([...semantic.keys()].sort()).toEqual([
      "accent",
      "bg",
      "border",
      "surface",
      "surface-muted",
      "text-primary",
      "text-secondary",
    ]);
  });

  it("语义色只通过 light-dark() 定义，没有第二套切换机制", () => {
    // 统计所有 --color-* 定义，必须与 light-dark() 的数量一致
    const definitions = [...flat.matchAll(/--color-[a-z-]+:/g)].length;
    expect(definitions).toBe(semantic.size);
    expect(flat).not.toMatch(/prefers-color-scheme[^}]*--color-/);
  });

  it("引用的原语都存在", () => {
    for (const [role, token] of semantic) {
      expect(primitives.has(token.light), `--color-${role} light`).toBe(true);
      expect(primitives.has(token.dark), `--color-${role} dark`).toBe(true);
    }
  });

  it("所有色值都在 sRGB 内", () => {
    for (const [name, value] of primitives) {
      const rgb = toLinearRgb(value);
      for (const channel of rgb) {
        expect(channel, `--${name}`).toBeGreaterThanOrEqual(-0.000001);
        expect(channel, `--${name}`).toBeLessThanOrEqual(1.000001);
      }
    }
  });

  it("组件引用的颜色令牌都已定义", () => {
    const used = new Set<string>();
    for (const source of Object.values(allCss)) {
      for (const match of source.matchAll(/var\(--color-([a-z-]+)\)/g)) {
        used.add(match[1]!);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((role) => !semantic.has(role))).toEqual([]);
  });

  /** 正文 ≥ 4.5:1，边框/分隔 ≥ 1.4:1（分隔线是装饰性弱边界，但必须看得见） */
  const checkedPairs: Array<[string, string, number]> = [
    ["text-primary", "bg", 4.5],
    ["text-secondary", "bg", 4.5],
    ["accent", "bg", 4.5],
    ["text-primary", "surface", 4.5],
    ["text-secondary", "surface", 4.5],
    ["text-secondary", "surface-muted", 4.5],
    ["accent", "surface-muted", 4.5],
    ["border", "surface", 1.4],
    ["border", "bg", 1.4],
  ];

  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme} 主题的对比度达标`, () => {
      const failures = checkedPairs
        .map(([foreground, background, minimum]) => ({
          pair: `${foreground} on ${background}`,
          ratio: contrast(color(foreground, scheme), color(background, scheme)),
          minimum,
        }))
        .filter((entry) => entry.ratio < entry.minimum)
        .map((entry) => `${entry.pair}: ${entry.ratio.toFixed(2)} < ${entry.minimum}`);
      expect(failures).toEqual([]);
    });
  }
});
