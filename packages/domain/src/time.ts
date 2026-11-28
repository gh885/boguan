import { DateTime } from "luxon";

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2}|\bGMT\b|\bUTC\b|\bUT\b)$/i;

const LOCAL_FORMATS = [
  "yyyy-M-d H:mm",
  "yyyy-M-d",
  "yyyy/M/d H:mm",
  "yyyy/M/d",
  "yyyy.M.d H:mm",
  "yyyy.M.d",
  "yyyy年M月d日 H:mm",
  "yyyy年M月d日",
  "d LLL yyyy H:mm",
  "d LLL yyyy",
  "d LLLL yyyy H:mm",
  "d LLLL yyyy",
  "LLL d yyyy H:mm",
  "LLL d yyyy",
  "LLLL d yyyy H:mm",
  "LLLL d yyyy",
];

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function inRange(year: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

function finish(date: DateTime | null): string | null {
  if (!date?.isValid) return null;
  if (!inRange(date.year)) return null;
  return date.toUTC().toISO({ suppressMilliseconds: false });
}

export function parsePublishedAt(
  raw: string | null | undefined,
  timeZone = "Asia/Shanghai",
): string | null {
  const text = raw?.replace(/\u00a0/g, " ").trim();
  if (!text) return null;

  if (HAS_OFFSET.test(text)) {
    return (
      finish(DateTime.fromRFC2822(text, { setZone: true })) ??
      finish(DateTime.fromISO(text, { setZone: true }))
    );
  }

  for (const format of LOCAL_FORMATS) {
    const date = DateTime.fromFormat(text, format, { zone: timeZone, locale: "en-US" });
    if (date.isValid) return finish(date);
  }

  return null;
}

export function yearInTimeZone(
  iso: string | null | undefined,
  timeZone = "Asia/Shanghai",
): number | null {
  if (!iso) return null;
  const date = DateTime.fromISO(iso, { zone: timeZone });
  return date.isValid ? date.year : null;
}

export function dayInTimeZone(
  iso: string | null | undefined,
  timeZone = "Asia/Shanghai",
): string | null {
  if (!iso) return null;
  const date = DateTime.fromISO(iso, { zone: timeZone });
  return date.isValid ? date.toFormat("yyyy-MM-dd") : null;
}

export function startOfDayInTimeZone(dayKey: string, timeZone = "Asia/Shanghai"): string | null {
  const date = DateTime.fromISO(dayKey, { zone: timeZone });
  if (!date.isValid) return null;
  return finish(date.startOf("day"));
}
