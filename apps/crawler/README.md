# @boguan/crawler

## 责任

独立抓取进程：调度、robots 与限速、源站适配、解析、归一、写库与运行报告。

## 技术栈

Bun 1.4、TypeScript strict、原生 `fetch` / `AbortSignal`、Cheerio、`rss-parser`、`robots-parser`、Drizzle、`@node-rs/jieba`、Commander。

## 约束

- 只有 `PoliteFetcher` 能发送 HTTP 请求。
- 遵守 robots；同一 origin 并发不超过 1，请求间隔至少 1 秒。
- 通过 `@boguan/database/crawler` 写元数据与 FTS，通过 `@boguan/body-store` 管理正文。
- 共享规则来自 `@boguan/domain`、`@boguan/search`；静态采集配置来自 `@boguan/catalog`。
- 不依赖 Astro、Web 页面或 Ops。
