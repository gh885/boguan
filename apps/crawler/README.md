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

## 命令

`vpr crawl` 由根脚本触发，参数直接透给 `src/cli.ts`：

| 参数          | 默认             | 作用                                          |
| :------------ | :--------------- | :-------------------------------------------- |
| `--mode`      | `incremental`    | `incremental` 按水位增量；`backfill` 回填历史 |
| `--max-pages` | 增量 5 / 回填 20 | 最多翻多少列表页；`0` = 翻到底                |
| `--page`      | `1`              | 从第几页开始                                  |
| `--source`    | 全部启用的源     | 只跑一个源（slug）                            |
| `--dry-run`   | 关               | 只抓一页并打印解析结果，不写库                |
| `--force`     | 关               | 忽略 blocked 标记跑一次                       |

`sitemap` 当列表入口的源在增量模式下不受 `--max-pages` 约束：切片之间不发请求，必须走完全部切片才能发现后段的新文章，那里它只约束回填。

## 技术栈

Bun、`fetch`、Cheerio、`rss-parser`、`robots-parser`、Drizzle；@boguan/database、@boguan/domain、@boguan/search、@boguan/catalog、@boguan/body-store。

## 约束

- 发请求只能经 `fetch.ts`；适配器不得直接 `fetch`。
- 同一 origin 并发 ≤ 1、间隔 ≥ 1s；遵守 robots 与 `Crawl-delay`；不携带登录态。
- 新增源 = 一个适配器文件 + `@boguan/catalog` 的一条 `SOURCES` 记录，管道代码不动。
- 解析失败必须抛错并进 `crawl_failures`，不静默写入空数据。
- 正文只交给 `@boguan/body-store`，不写进数据库，也不进日志。
