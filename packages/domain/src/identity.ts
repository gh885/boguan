import { createHash } from "node:crypto";

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

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  url.hash = "";

  const keys = Array.from(url.searchParams.keys());
  for (const key of keys) {
    if (isTracking(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function titleNorm(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function slugify(input: string): string | null {
  if (/[^\p{ASCII}]/u.test(input)) return null;
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

export function normalizeRawTag(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/^#+/, "")
    .replace(/[\s\u3000]+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeRawTags(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = normalizeRawTag(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function contentHash(title: string, summary: string, body: string): string {
  return createHash("sha256").update([title, summary, body].join("\n")).digest("hex");
}
