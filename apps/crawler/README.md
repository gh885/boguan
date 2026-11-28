# @boguan/crawler

## 责任

抓取进程：传输（限速、robots、条件请求、重试、编码）、源适配器、归一、入库编排与收尾去重。入口是 `src/cli.ts`，由仓库根的 `crawl` 脚本触发。

| 文件               | 职责                                                 |
| :----------------- | :--------------------------------------------------- |
| `src/cli.ts`       | 参数解析与模式分派                                   |
| `src/fetch.ts`     | 唯一的发请求入口：按 origin 排队、robots、重试、编码 |
| `src/robots.ts`    | robots.txt 抓取与缓存                                |
| `src/adapters/`    | 每个源一个文件，声明 `capabilities` 并解析列表与详情 |
| `src/normalize.ts` | canonical URL、时间、摘要、标题归一、指纹            |
| `src/pipeline.ts`  | 单条目的入库判断与写库、批次收尾                     |
| `src/sitemap.ts`   | sitemap 作为列表入口时的解析                         |

## 技术栈

Bun、`fetch`、Cheerio、`rss-parser`、`robots-parser`、Drizzle；@boguan/database、@boguan/domain、@boguan/search、@boguan/catalog、@boguan/body-store。

## 约束

- 发请求只能经 `fetch.ts`；适配器不得直接 `fetch`。
- 同一 origin 并发 ≤ 1、间隔 ≥ 1s；遵守 robots 与 `Crawl-delay`；不携带登录态。
- 新增源 = 一个适配器文件 + `@boguan/catalog` 的一条 `SOURCES` 记录，管道代码不动。
- 解析失败必须抛错并进 `crawl_failures`，不静默写入空数据。
- 正文只交给 `@boguan/body-store`，不写进数据库，也不进日志。
