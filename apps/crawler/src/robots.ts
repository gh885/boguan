import robotsParser from "robots-parser";

const UA_PRODUCT = "boguan";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface RobotsRules {
  isAllowed(url: string): boolean;
  crawlDelayMs(): number;
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
      return { ...ALLOW_ALL, note: "allow-all (network-error)" };
    }

    const { status, text, contentType } = response;
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
