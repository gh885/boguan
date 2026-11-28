import { describe, expect, it } from "vite-plus/test";
import { dayInTimeZone, startOfDayInTimeZone } from "./date";
import {
  EDITION_MIN_POSTS,
  EDITION_TIME_ZONE,
  editionDay,
  editionNumber,
  editionNumberAt,
  editionRange,
  isIndexableEdition,
} from "./edition";

/**
 * 「期」的定义（docs/ARCHITECTURE.md §6）：一期 = 一个自然日，期号 = 从创刊日起的第几天。
 * 这份测试守三件事：期号与日期互推、期界在**北京时间零点**而不是 UTC 零点、没有新增的期不跳号。
 */

describe("期号与日期互推", () => {
  it("创刊号是第 1 期", () => {
    expect(editionNumber("2026-10-31")).toBe(1);
    expect(editionDay(1)).toBe("2026-10-31");
  });

  it("逐日加一，跨月跨年都不出错", () => {
    expect(editionNumber("2026-11-01")).toBe(2);
    expect(editionNumber("2026-11-30")).toBe(31);
    expect(editionNumber("2026-12-01")).toBe(32);
    expect(editionNumber("2027-01-01")).toBe(63);
    // 2028 是闰年
    expect(editionDay(editionNumber("2028-02-29") as number)).toBe("2028-02-29");
  });

  it("往返一致：400 期连续编号都能反推回日期", () => {
    for (let number = 1; number <= 400; number += 1) {
      expect(editionNumber(editionDay(number) as string)).toBe(number);
    }
  });

  it("非法输入返回 null，而不是抛错或编造", () => {
    expect(editionNumber("2026-13-01")).toBe(null);
    expect(editionNumber("20261128")).toBe(null);
    expect(editionDay(0)).toBe(null);
    expect(editionDay(1.5)).toBe(null);
  });
});

describe("期界在 Asia/Shanghai 的零点", () => {
  it("第 2 期的时间窗是 UTC 前一天 16:00 到当天 16:00", () => {
    expect(editionRange(2)).toEqual({
      startIso: "2026-10-31T16:00:00.000Z",
      endIso: "2026-11-01T16:00:00.000Z",
    });
  });

  it("北京时间零点前后的稿子分属两期，UTC 日期不作数", () => {
    // 上海 10-31 23:59:59 → 创刊号
    expect(editionNumberAt("2026-10-31T15:59:59.999Z")).toBe(1);
    // 上海 11-01 00:00:00 → 第 2 期（UTC 还是 10-31）
    expect(editionNumberAt("2026-10-31T16:00:00.000Z")).toBe(2);
  });

  it("时间窗覆盖自己那一期的边界，左闭右开", () => {
    const range = editionRange(2) as { startIso: string; endIso: string };
    expect(editionNumberAt(range.startIso)).toBe(2);
    expect(editionNumberAt(range.endIso)).toBe(3);
  });

  it("日期键与「某时区的自然日」是同一套口径", () => {
    const now = new Date("2026-11-28T03:00:00.000Z");
    expect(dayInTimeZone(now.toISOString(), EDITION_TIME_ZONE)).toBe(
      editionDay(editionNumberAt(now) as number),
    );
  });

  it("startOfDayInTimeZone 给出的是北京零点，不是 UTC 零点", () => {
    expect(startOfDayInTimeZone("2026-11-28")).toBe("2026-11-27T16:00:00.000Z");
    expect(startOfDayInTimeZone("2026-11-28", "UTC")).toBe("2026-11-28T00:00:00.000Z");
    expect(startOfDayInTimeZone("2026-11-31")).toBe(null);
  });
});

describe("薄期门槛", () => {
  it("门槛是 3 篇，与薄标签页同一套思路", () => {
    expect(EDITION_MIN_POSTS).toBe(3);
    expect(isIndexableEdition(2)).toBe(false);
    expect(isIndexableEdition(3)).toBe(true);
  });
});
