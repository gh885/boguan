import { describe, expect, it } from "vite-plus/test";
import { createRumConfig, sanitizeRumPayload } from "./rum";

describe("production RUM privacy", () => {
  it("removes search terms and secrets throughout a real batch-shaped payload", () => {
    const clean = sanitizeRumPayload({
      view: {
        name: "/search?q=private-query",
        url: "https://boguan.org.cn/search?q=private-query#x",
      },
      events: [
        {
          title: "Search: private-query",
          referrer: "https://example.com/?token=secret",
          snapshots: { body: "private-body" },
          message: "Load failed https://example.com/a.js?token=secret#part",
          view: { id: "view-id", url: "/search?q=private-query" },
          duration: 125,
        },
      ],
      session: { id: "anonymous-session" },
    });
    const encoded = JSON.stringify(clean);
    expect(encoded).not.toMatch(/private-query|private-body|secret|#part|snapshots|title/);
    expect(encoded).toContain("anonymous-session");
    expect(encoded).toContain('"duration":125');
    expect(encoded).toContain("https://example.com/a.js");
  });

  it("enables basic metrics without content, actions, replay or trace collection", () => {
    const config = createRumConfig();
    expect(config.collectors).toMatchObject({
      perf: true,
      webVitals: true,
      jsError: true,
      api: false,
      consoleError: false,
      action: false,
      click: false,
    });
    expect(config.replay).toBe(false);
    expect(config.tracing).toBe(false);
    expect(config.remoteConfig.enable).toBe(false);
    expect(config.parseViewName("https://boguan.org.cn/search?q=private")).toBe("/search");
  });
});
