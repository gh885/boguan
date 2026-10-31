/**
 * 发布时间解析（docs/ARCHITECTURE.md §5「归一」第 2 条）。
 *
 * 两条铁律：
 * - **宁可缺失，不要编造**：解析不出来就返回 `null`，由调用方落 `published_at = NULL`。
 * - 无时区的源站时间按 `sources.timezone` 解释，再转成 UTC 存储（`published_at` 一直是 UTC）。
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** 带显式时区（`Z` / `+08:00` / `GMT`）的串交给 `Date.parse`，它比手写正则准 */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2}|\bGMT\b|\bUTC\b|\bUT\b)$/i;

/** `2026-10-29`、`2026/10/29`、`2026.10.29`、`2026年10月29日`，可带时间 */
const NUMERIC_DATE =
  /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:日)?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?!\d)/;

/** `28 Oct 2022` / `28 October 2022` */
const EN_DMY = /(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:[,T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** `Oct 28, 2022` / `October 28 2022` */
const EN_MDY =
  /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[,T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validParts(parts: LocalParts): boolean {
  const { year, month, day, hour, minute, second } = parts;
  return (
    year >= 1990 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function toParts(match: RegExpMatchArray, order: "numeric" | "dmy" | "mdy"): LocalParts | null {
  const pick = (index: number) => {
    const value = match[index];
    return value === undefined ? 0 : Number(value);
  };

  let year: number;
  let month: number;
  let day: number;

  if (order === "numeric") {
    year = pick(1);
    month = pick(2);
    day = pick(3);
  } else if (order === "dmy") {
    day = pick(1);
    month = MONTHS[match[2].toLowerCase()] ?? 0;
    year = pick(3);
  } else {
    month = MONTHS[match[1].toLowerCase()] ?? 0;
    day = pick(2);
    year = pick(3);
  }

  const parts = { year, month, day, hour: pick(4), minute: pick(5), second: pick(6) };
  return validParts(parts) ? parts : null;
}

/** 某个时区在给定时刻的 UTC 偏移（毫秒），用 Intl 反查，不引时区数据库 */
function offsetMs(epochMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - epochMs;
}

/** 源站本地时间 → UTC 毫秒。两次逼近以覆盖夏令时切换当天 */
export function zonedToUtc(parts: LocalParts, timeZone: string): number {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let guess = naive - offsetMs(naive, timeZone);
  guess = naive - offsetMs(guess, timeZone);
  return guess;
}

function toIso(parts: LocalParts, timeZone: string): string {
  return new Date(zonedToUtc(parts, timeZone)).toISOString();
}

/**
 * 解析源站时间串，返回 ISO 8601 UTC；解析不出来返回 `null`。
 * 只有「整串基本符合某个已知形态」才算成功，避免把 `2023` 这种残缺串读成日期。
 */
export function parsePublishedAt(
  raw: string | null | undefined,
  timeZone = "Asia/Shanghai",
): string | null {
  const text = raw?.replace(/\u00a0/g, " ").trim();
  if (!text) return null;

  if (HAS_OFFSET.test(text)) {
    const epoch = Date.parse(text);
    if (Number.isNaN(epoch)) return null;
    const iso = new Date(epoch).toISOString();
    // 明显的垃圾时间（1970 / 未来太远）不入库
    const year = Number(iso.slice(0, 4));
    return year >= 1990 && year <= 2100 ? iso : null;
  }

  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const parts = toParts(numeric, "numeric");
    if (parts) return toIso(parts, timeZone);
  }

  const dmy = text.match(EN_DMY);
  if (dmy) {
    const parts = toParts(dmy, "dmy");
    if (parts) return toIso(parts, timeZone);
  }

  const mdy = text.match(EN_MDY);
  if (mdy) {
    const parts = toParts(mdy, "mdy");
    if (parts) return toIso(parts, timeZone);
  }

  return null;
}

/** ISO 时间在某个时区的年份；`/year/[year]` 与 `posts.published_year` 都用它 */
export function yearInTimeZone(
  iso: string | null | undefined,
  timeZone = "Asia/Shanghai",
): number | null {
  if (!iso) return null;
  const epoch = Date.parse(iso);
  if (Number.isNaN(epoch)) return null;
  const year = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(new Date(epoch)),
  );
  return Number.isFinite(year) ? year : null;
}
