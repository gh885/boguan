import { dayInTimeZone, startOfDayInTimeZone } from "./time";

export const EDITION_EPOCH = "2026-10-31";

export const EDITION_TIME_ZONE = "Asia/Shanghai";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function dayKeyToMs(dayKey: string): number | null {
  if (!DAY_KEY.test(dayKey)) return null;
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

const EPOCH_MS = dayKeyToMs(EDITION_EPOCH) as number;

export function editionNumber(dayKey: string): number | null {
  const ms = dayKeyToMs(dayKey);
  return ms === null ? null : Math.round((ms - EPOCH_MS) / DAY_MS) + 1;
}

export function editionDay(number: number): string | null {
  if (!Number.isInteger(number) || number < 1) return null;
  return new Date(EPOCH_MS + (number - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function editionNumberAt(value: string | Date, timeZone = EDITION_TIME_ZONE): number | null {
  const iso = value instanceof Date ? value.toISOString() : value;
  const day = dayInTimeZone(iso, timeZone);
  return day === null ? null : editionNumber(day);
}

export interface EditionRange {
  startIso: string;
  endIso: string;
}

export function editionRange(number: number, timeZone = EDITION_TIME_ZONE): EditionRange | null {
  const day = editionDay(number);
  const nextDay = editionDay(number + 1);
  if (!day || !nextDay) return null;
  const startIso = startOfDayInTimeZone(day, timeZone);
  const endIso = startOfDayInTimeZone(nextDay, timeZone);
  return startIso && endIso ? { startIso, endIso } : null;
}
