import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { openBodyStore } from "./index";

describe("正文存储", () => {
  it("写入 → 读回 → 删除，内容是 gzip 后的文本", () => {
    const dir = mkdtempSync(join(tmpdir(), "boguan-bodies-"));
    try {
      const store = openBodyStore(dir);
      store.put(7, "多级缓存\n的分层设计");
      expect(store.read(7)).toBe("多级缓存\n的分层设计");
      expect(store.ids()).toEqual([7]);
      store.delete(7);
      expect(store.read(7)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对账删除不在 keep 里的孤文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "boguan-bodies-"));
    try {
      const store = openBodyStore(dir);
      store.put(1, "a");
      store.put(2, "b");
      store.put(3, "c");
      expect(store.prune(new Set([1, 3]))).toBe(1);
      expect(store.ids()).toEqual([1, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
