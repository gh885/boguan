import robotsParser from "robots-parser";

/**
 * robots.txt 判定（docs/ARCHITECTURE.md §5「传输层」）。
 *
 * 作用域是 **origin**，不是 source：一个公司可能有多个渠道落在同一个 host 上，
 * 抓一次 robots.txt 就够。缓存放在进程内 24h——cron 每天起一次进程，
 * 等于每次运行开头抓一遍，跨运行不缓存（避免规则改了还按旧规则抓）。
 */

const UA_PRODUCT = "boguan";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface RobotsRules {
  isAllowed(url: string): boolean;
  /** 源站声明的 Crawl-delay（毫秒），与默认间隔取大 */
  crawlDelayMs(): number;
  /** 判定来源，写进日志，方便解释「为什么这个源没抓」 */
  note: string;
}

type RawGet = (
  url: string,
) => Promise<{ status: number; text: string; contentType: string | null }>;

const ALLOW_ALL: RobotsRules = {
  isAllowed: () => true,
  crawlDelayMs: () => 0,
  note: "allow-all",
};

function disallowAll(note: string): RobotsRules {
  return { isAllowed: () => false, crawlDelayMs: () => 0, note };
}

/** `200 text/html` 的「robots.txt」多半是 SPA 兜底页，不是规则文件，按不存在处理 */
function looksLikeHtml(text: string, contentType: string | null): boolean {
  const type = contentType?.toLowerCase() ?? "";
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;
  return text.trimStart().startsWith("<");
}

export class RobotsCache {
  private entries = new Map<string, { rules: RobotsRules; at: number }>();

  constructor(private readonly get: RawGet) {}

  async rules(origin: string): Promise<RobotsRules> {
    const now = Date.now();
    const cached = this.entries.get(origin);
    if (cached && now - cached.at < TTL_MS) return cached.rules;

    const rules = await this.load(origin);
    this.entries.set(origin, { rules, at: now });
    return rules;
  }

  private async load(origin: string): Promise<RobotsRules> {
    const url = `${origin}/robots.txt`;
    let response: Awaited<ReturnType<RawGet>>;
    try {
      response = await this.get(url);
    } catch {
      // 网络错误：按「抓不到就按允许」处理，避免一次 DNS 抖动把整站挡掉
      return { ...ALLOW_ALL, note: "allow-all (network-error)" };
    }

    const { status, text, contentType } = response;
    // RFC 9309：4xx 视为无限制；5xx 视为全站禁止（保守），下轮再试
    if (status === 401 || status === 403) return disallowAll(`disallow-all (${status})`);
    if (status >= 500 || status === 429) return disallowAll(`disallow-all (${status})`);
    if (status >= 400) return { ...ALLOW_ALL, note: `allow-all (${status})` };
    if (looksLikeHtml(text, contentType))
      return { ...ALLOW_ALL, note: "allow-all (html-fallback)" };

    const robot = robotsParser(url, text);
    const delaySeconds = robot.getCrawlDelay(UA_PRODUCT) ?? robot.getCrawlDelay("*") ?? 0;
    return {
      isAllowed: (target: string) => robot.isAllowed(target, UA_PRODUCT) !== false,
      crawlDelayMs: () => Math.max(0, Math.round(delaySeconds * 1000)),
      note: "parsed",
    };
  }
}
