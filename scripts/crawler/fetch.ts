import { eq } from "drizzle-orm";
import type { Db } from "../../src/lib/db/index";
import { httpCache } from "../../src/lib/db/schema";
import { originOf } from "../../src/lib/domain/url";
import { RobotsCache } from "./robots";

/**
 * 唯一能发 HTTP 的地方（docs/ARCHITECTURE.md §5）。
 *
 * 限速、robots、条件请求、重试、编码判定全在这一层，适配器只负责把响应变成结构化字段。
 * 合规是结构保证的：适配器没有别的途径发请求，也就没法绕开间隔或 robots。
 */

/**
 * UA 必须是 ASCII：HTTP header 字段值不能含非 ASCII 字符，否则 fetch 会直接抛错。
 * 想解释自己是谁，把说明放在 /about 页面里，别塞进 UA。
 */
export const USER_AGENT = "boguan/0.1 (+https://boguan.dev/about; aggregator; honors robots.txt)";

export interface FetchOptions {
  /** 同一 host 的两次请求最小间隔；robots 的 Crawl-delay 更大时以它为准 */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** 只读演练：不写 http_cache */
  dryRun?: boolean;
}

export interface FetchedPage {
  url: string;
  status: number;
  /** 304 / robots 挡住时没有正文 */
  text: string | null;
  notModified: boolean;
  /** robots.txt 不允许 */
  denied: boolean;
  error: string | null;
}

export interface FetchStats {
  requests: number;
  notModified: number;
  denied: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Content-Type 与 `<meta charset>` 双保险：不少老站点仍是 GBK */
export function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return normalizeCharset(fromHeader);

  // 用 latin1 看字节，只为嗅 meta 标签
  const sniff = new TextDecoder("latin1").decode(head.slice(0, 2048));
  const fromMeta =
    sniff.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    sniff.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
  return fromMeta ? normalizeCharset(fromMeta) : "utf-8";
}

function normalizeCharset(label: string): string {
  const lower = label.toLowerCase();
  // GBK/GB2312 是 GB18030 的子集，统一用它解，避免生僻字变问号
  if (["gbk", "gb2312", "gb-2312", "gb18030"].includes(lower)) return "gb18030";
  return lower;
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export class PoliteFetcher {
  private nextSlot = new Map<string, number>();
  private queues = new Map<string, Promise<void>>();
  private robots: RobotsCache;
  stats: FetchStats = { requests: 0, notModified: 0, denied: 0 };
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly db: Db,
    private readonly options: FetchOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.robots = new RobotsCache((url) => this.rawGet(url));
  }

  /** 这次运行对该 host 的 robots 判定结果，写进日志便于解释「为什么没抓」 */
  async robotsNote(url: string): Promise<string> {
    const origin = originOf(url);
    if (!origin) return "invalid-url";
    const rules = await this.robots.rules(origin);
    return rules.note;
  }

  resetStats(): void {
    this.stats = { requests: 0, notModified: 0, denied: 0 };
  }

  /** robots.txt 自身，不经过 robots 判定，但仍走 host 排队 */
  private async rawGet(url: string) {
    const origin = originOf(url);
    if (!origin) throw new Error(`非法 URL：${url}`);
    return this.withHost(origin, 0, async () => {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        text: decode(bytes, response.headers.get("content-type")),
        contentType: response.headers.get("content-type"),
      };
    });
  }

  async page(url: string, options: { conditional?: boolean } = {}): Promise<FetchedPage> {
    const origin = originOf(url);
    if (!origin)
      return { url, status: 0, text: null, notModified: false, denied: false, error: "非法 URL" };

    const rules = await this.robots.rules(origin);
    if (!rules.isAllowed(url)) {
      this.stats.denied += 1;
      return {
        url,
        status: 0,
        text: null,
        notModified: false,
        denied: true,
        error: `robots: ${rules.note}`,
      };
    }

    const delay = Math.max(this.minIntervalMs, rules.crawlDelayMs());
    return this.withHost(origin, delay, () => this.request(url, options.conditional !== false));
  }

  private async request(url: string, conditional: boolean): Promise<FetchedPage> {
    const cached = conditional
      ? this.db.select().from(httpCache).where(eq(httpCache.url, url)).get()
      : undefined;

    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    if (cached?.etag) headers["if-none-match"] = cached.etag;
    if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;

    let lastError = "未知错误";
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.stats.requests += 1;
      try {
        const response = await fetch(url, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 304) {
          this.stats.notModified += 1;
          this.touchCache(url);
          return { url, status: 304, text: null, notModified: true, denied: false, error: null };
        }

        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const contentType = response.headers.get("content-type");
          this.storeCache(url, response.headers.get("etag"), response.headers.get("last-modified"));
          return {
            url,
            status: response.status,
            text: decode(bytes, contentType),
            notModified: false,
            denied: false,
            error: null,
          };
        }

        lastError = `HTTP ${response.status}`;
        if (RETRYABLE.has(response.status) && attempt < this.maxRetries) {
          await this.backoff(attempt, retryAfterMs(response.headers.get("retry-after")));
          continue;
        }
        return {
          url,
          status: response.status,
          text: null,
          notModified: false,
          denied: false,
          error: lastError,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < this.maxRetries) {
          await this.backoff(attempt, null);
          continue;
        }
      }
    }

    return { url, status: 0, text: null, notModified: false, denied: false, error: lastError };
  }

  private async backoff(attempt: number, retryAfter: number | null): Promise<void> {
    const wait = retryAfter ?? Math.min(8000, 500 * 2 ** attempt);
    await sleep(wait);
  }

  private storeCache(url: string, etag: string | null, lastModified: string | null): void {
    if (this.options.dryRun) return;
    if (!etag && !lastModified) return;
    const now = new Date().toISOString();
    this.db
      .insert(httpCache)
      .values({ url, etag, lastModified, checkedAt: now })
      .onConflictDoUpdate({ target: httpCache.url, set: { etag, lastModified, checkedAt: now } })
      .run();
  }

  private touchCache(url: string): void {
    if (this.options.dryRun) return;
    this.db
      .update(httpCache)
      .set({ checkedAt: new Date().toISOString() })
      .where(eq(httpCache.url, url))
      .run();
  }

  /**
   * 同一个 host 串行 + 间隔控制。
   * 跨 host 才并发，这里用「按 host 串成一条链」实现，天然满足「并发 ≤ 1」。
   */
  private async withHost<T>(origin: string, delayMs: number, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(origin) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.queues.set(origin, chained);

    await previous;
    try {
      const now = Date.now();
      const slot = this.nextSlot.get(origin) ?? 0;
      if (slot > now) await sleep(slot - now);
      this.nextSlot.set(origin, Date.now() + delayMs);
      return await task();
    } finally {
      release();
      // 链尾已经没有等待者时清掉，避免 Map 无限增长
      if (this.queues.get(origin) === chained) this.queues.delete(origin);
    }
  }
}
