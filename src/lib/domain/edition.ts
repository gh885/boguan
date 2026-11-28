import { dayInTimeZone, startOfDayInTimeZone } from "./date";

/**
 * 「期」的定义（docs/ARCHITECTURE.md §6「期号」）。
 *
 * 一期 = 一个自然日（`Asia/Shanghai`）的定版；期号 = 从创刊日起的第几天。
 *
 * 三条不能改的规矩：
 * 1. **期号与日期互为函数**：第 29 期就是 2026-11-28。读者看到期号能反推日期，
 *    这是「期」唯一真正有用的属性，不能拿文章总数之类的指标冒充。
 * 2. **出版日归属 `first_seen_at`（入库时间），不归 `published_at`（原发时间）**。
 *    原发时间决定列表怎么排序，入库时间决定这篇稿子登在哪一期。两条时间轴不许互相借。
 * 3. **某天没有新稿也照常出刊**：期号连续，只是「本期无新增」。跳号等于让读者失去坐标系。
 *
 * 这里只有纯计算，不碰数据库；查询在 `src/lib/db/queries/posts.ts`(firstSeenFrom / firstSeenTo)。
 */

/** 创刊号：仓库首次上线、全量稿件一次性入版的那一天 */
export const EDITION_EPOCH = "2026-10-31";

/** 期界所在时区：与全站展示口径一致（`src/lib/i18n/config.ts` 的 displayTimeZone） */
export const EDITION_TIME_ZONE = "Asia/Shanghai";

/**
 * 期页进入 sitemap / `index` 的门槛，与薄标签页同一套思路（`src/lib/tags.ts`）。
 *
 * 日报必然有「今天只来了一篇」的薄日子，薄期照样生成（期号不能断），但 `noindex, follow`：
 * 一个标题 + 一张卡片的页面不该占索引位。
 */
export const EDITION_MIN_POSTS = 3;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** `2026-11-28` → 该日历日的 UTC 零点毫秒。只用来做日历日算术，不代表任何时区时刻 */
function dayKeyToMs(dayKey: string): number | null {
  if (!DAY_KEY.test(dayKey)) return null;
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

const EPOCH_MS = dayKeyToMs(EDITION_EPOCH) as number;

/** 出版日 → 期号（早于创刊日返回 ≤ 0，调用方自己决定要不要滤掉） */
export function editionNumber(dayKey: string): number | null {
  const ms = dayKeyToMs(dayKey);
  return ms === null ? null : Math.round((ms - EPOCH_MS) / DAY_MS) + 1;
}

/** 期号 → 出版日（`YYYY-MM-DD`） */
export function editionDay(number: number): string | null {
  if (!Number.isInteger(number) || number < 1) return null;
  return new Date(EPOCH_MS + (number - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** 某个时刻属于第几期。首页报头与期页的静态路径都用它 */
export function editionNumberAt(value: string | Date, timeZone = EDITION_TIME_ZONE): number | null {
  const iso = value instanceof Date ? value.toISOString() : value;
  const day = dayInTimeZone(iso, timeZone);
  return day === null ? null : editionNumber(day);
}

export interface EditionRange {
  /** 左闭 */
  startIso: string;
  /** 右开 */
  endIso: string;
}

/**
 * 该期的时间窗（UTC ISO，左闭右开），直接喂给 `firstSeenFrom` / `firstSeenTo`。
 * 用「上海零点」而不是「UTC 零点」：否则每天有 8 小时的稿子会登错期。
 */
export function editionRange(number: number, timeZone = EDITION_TIME_ZONE): EditionRange | null {
  const day = editionDay(number);
  const nextDay = editionDay(number + 1);
  if (!day || !nextDay) return null;
  const startIso = startOfDayInTimeZone(day, timeZone);
  const endIso = startOfDayInTimeZone(nextDay, timeZone);
  return startIso && endIso ? { startIso, endIso } : null;
}

/** 期页是否够厚到值得索引；页面与 sitemap 用的是同一个判断 */
export function isIndexableEdition(postCount: number): boolean {
  return postCount >= EDITION_MIN_POSTS;
}
