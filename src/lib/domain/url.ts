/**
 * URL 归一（docs/ARCHITECTURE.md §5「归一」）。
 *
 * 目标是让「同一篇文章的不同写法」落到同一个字符串上，唯一的判定键是 `posts.canonical_url`。
 * 只做**安全**的归一：不猜源站支不支持 https，不改 host，不删看起来像正文的 query。
 */

/** 追踪参数：值无意义，删掉不改变资源身份 */
const TRACKING_PARAMS = new Set([
  "from",
  "ref",
  "referer",
  "referrer",
  "source",
  "src",
  "spm",
  "scm",
  "share_token",
  "share_source",
  "scene",
  "fbclid",
  "gclid",
  "yclid",
  "mc_cid",
  "mc_eid",
]);

const TRACKING_PREFIXES = ["utm_", "hmsr", "hmpl", "hmcu", "hmkw", "hmci", "pk_", "wx_"];

function isTracking(key: string): boolean {
  const lower = key.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * 归一化 URL。`base` 用于把列表页里的相对链接补成绝对地址。
 * 返回 `null` 表示这条链接不该入库（非 http(s)、解析失败）。
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // host 统一小写由 URL 负责；这里只清掉协议默认端口
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  // 锚点不参与资源身份
  url.hash = "";

  const keys = Array.from(url.searchParams.keys());
  for (const key of keys) {
    if (isTracking(key)) url.searchParams.delete(key);
  }
  // 参数顺序不影响资源身份，排序后才是稳定键
  url.searchParams.sort();

  // 末尾斜杠：只保留根路径的 `/`，其余统一去掉
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** 同一个 host 的请求在 crawler 里必须串行，判定用它 */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** origin（scheme + host），robots.txt 与限速的作用域 */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
