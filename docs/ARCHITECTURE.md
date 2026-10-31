# 架构与决策

本文件记录博观的系统形状与关键技术决策。**改动实现前先读这里；改动决策时先更新这里。**

---

## 1. 定位与目标

**做什么**：把国内互联网公司技术团队的官方工程博客聚合到一处，提供按公司、技术标签、年份的浏览，以及标题与正文的检索；阅读时跳转原文。

### 非目标

- 不做全文转载或镜像
- 不做用户体系、评论、收藏
- 不做商业化
- 不追求高并发；单机、每日更新即可

---

## 2. 系统形状

两个进程，一个数据库文件。

```text
                 ┌──────────────────────────┐
                 │  crawler（独立进程/定时） │
                 │  调度 → 抓取 → 解析 → 归一 │
                 └────────────┬─────────────┘
                              │ 写入
                              ▼
                 ┌──────────────────────────┐
                 │        SQLite            │
                 │  posts / tags / FTS5     │
                 └────────────┬─────────────┘
                              │ 只读
                              ▼
                 ┌──────────────────────────┐
                 │  web（Astro）            │
                 │  静态列表页 + SSR 搜索   │
                 └────────────┬─────────────┘
                              │
                              ▼
                        用户浏览器 → 原文
```

### 为什么是两个进程

- 抓取是**批量、慢、易失败、需要重试**的任务，生命周期与 HTTP 请求完全不同。
- 抓取脚本崩溃时，网站必须继续在线。
- 抓取完成后需要触发站点重建，这是一个明确的边界事件。

因此：`crawler` 不 import 任何 Astro 代码（页面、组件、layout），`web` 不执行任何抓取。二者只通过数据库交汇。

共享的是**纯逻辑**，边界写在 `AGENTS.md`，并由 `src/lib/db/guard.test.ts` 守着：

```text
crawler → src/lib/{db,domain,search}   纯函数与 schema，没有 Astro 依赖
web     → src/lib/db/queries/**        只读查询，不许碰正文来源
两边都  ✗ src/pages | src/components | src/layouts
```

---

## 3. 数据流

一次运行（`vpr crawl`，默认增量）：

1. 取出 `enabled` 的源逐个处理；源之间可以并行，但**同一 origin 的请求永远串行**（`fetchPolite` 按 origin 排队）
2. 拉列表页（带 `If-None-Match` / `If-Modified-Since`），解析出条目：标题、绝对 URL、原始时间串、摘要、源站标签
3. 归一：canonical URL、时间、摘要、标题归一键
4. 按 `canonical_url` 查库：
   - **不存在** → 需要正文就进详情页（`detail: 'none'` 的源直接用 feed 里的全文），插入、写正文文件、写 FTS
   - **已存在且标题/摘要/时间都没变、正文文件也在** → 只更新 `last_seen_at`，**不进详情页**（这是每日运行省请求的关键）
   - **变了** → 进详情页（有条件请求）、重算指纹、覆盖正文文件与 FTS、重算标签
5. 增量停止条件：**当前页所有条目的发布时间都早于水位 6 小时以上就停**；混合页再看「连续 10 条」兜底。停止判定看时间水位，不看条数——置顶与列表重排都不会让它误停
6. 每个源一行 `crawl_runs`（挂在 `crawl_jobs` 下），逐 URL 的失败进 `crawl_failures`；单源失败不阻塞其它源
7. 全部源跑完后：跨源去重 → 写批次汇总 → 建议重建站点

两种模式共用同一套代码，只有停止条件不同：

| 模式                  | 停止条件                                      | 何时用           |
| :-------------------- | :-------------------------------------------- | :--------------- |
| `incremental`（默认） | 整页早于水位（6h 余量），或连续 10 条早于水位 | 每天定时         |
| `backfill`            | 翻到 `--max-pages` 上限（`0` 表示不设上限）   | 首次接入、补历史 |

**首次接入默认只回填 20 页**：归一与标签规则还没稳定时全量回填，等于用错误的规则污染几千条数据，返工还要再骚扰源站一遍；规则稳定后再手动 `--mode=backfill --max-pages=0` 补全历史。增量模式**不替代**回填：跑完水位后，更早的页面只由 `backfill` 取。

水位（`sources.watermark_at`）= 见过的最大 `published_at`。回填不更新它以外的东西，也不受它限制；没有 `cursor` 这种东西——回填中断就重跑，幂等，靠 `canonical_url` 与内容指纹去重。

### 每日一次运行的请求预算

以实测的两个源为例（见 `docs/SOURCES.md`）：

| 场景                     | 请求数                             |
| :----------------------- | :--------------------------------- |
| 美团（RSS 带全文）无更新 | 1                                  |
| 美团首次回填 10 篇       | 1                                  |
| 有赞无更新（2 页列表）   | 2                                  |
| 有赞首次回填 25 篇       | 1 + 25（每个详情页一次）           |
| 有赞全量回填（约 40 页） | 约 40 + 400，约 7 分钟（≥1s/请求） |

---

## 4. 数据模型

已落地为 `src/lib/db/schema.ts`（Drizzle + SQLite），迁移在 `drizzle/`（`vpr db:generate` 生成、`vpr db:init` 应用）。约定：**时间一律存 ISO 8601 UTC 字符串**，表名列名用 snake_case。

```text
companies          公司
  id, slug unique, name, name_en?, homepage?, logo_url?, created_at

sources            一个公司的发布渠道（官网博客 / RSS / 平台账号）
  id, company_id, slug unique, name
  adapter           对应 scripts/crawler/adapters/*，**解析形态的唯一真相源**
  list_url, timezone (默认 Asia/Shanghai), lang, priority
  enabled, watermark_at?, blocked_at?, blocked_reason?, last_run_at?, created_at

posts              文章元数据（不含正文）
  id, source_id, company_id
  canonical_url unique, title, title_norm, summary（≤200 字，CHECK 约束）
  lang, author?
  published_at?       ISO UTC；解析不出来就是 NULL，不编造
  published_at_raw?   源站原始串，便于回溯解析规则
  published_year?     按 sources.timezone 取年，/year/[year] 直接走索引
  reading_minutes?   按正文估算的阅读分钟数（派生元数据，不是正文）
  has_code?          详情页是否含 <pre>/<code>；列表页拿不到正文时为 NULL
  cover_url?, content_hash, duplicate_of_id?, is_visible
  first_seen_at, last_seen_at

tags               id, slug unique, name
post_tags          post_id + tag_id 复合主键, origin (source|rule|manual)
tag_aliases        raw unique → tag_id, source (auto|manual)
http_cache         url pk, etag, last_modified, checked_at
crawl_jobs         id, mode, started_at, finished_at, status, sources, requests,
                   inserted, updated, duplicates, failed, error
crawl_runs         id, job_id, source_id, mode, started_at, finished_at, status, requests,
                   not_modified, listed, inserted, updated, unchanged, duplicates, failed, error
crawl_failures     id, run_id, stage (list|detail), url, status?, message, at

posts_fts          FTS5 虚拟表：title_tokens, body_tokens
                   contentless, contentless_delete, rowid = posts.id
```

几条需要解释的取舍：

- **正文不在这张库里**。它在 crawler 私有的文件目录 `data/bodies/<id>.txt.gz`（`src/lib/db/bodies.ts`），web 进程既没有表也没有路径。这不是洁癖：只要正文进了同一个 SQLite 文件，硬性规则 1 就只剩「查询层不去 select 它」这一条约定；移出去之后它变成结构性的。正文是**派生数据**——最坏情况能从源站重抓，所以它不参与事务、不参与迁移，崩溃只会留下孤文件，由 `vpr db:check --prune` 清掉。
- **`posts_fts` 是 contentless 表**：只存 term 与位置，列值取回来是 `NULL`，`snippet()` / `highlight()` 不可用。因此搜索结果**只展示摘要**，不给命中上下文（§7）。
- **索引与可见性解耦**：不变量只有一条——「每篇帖子都有一行索引」。`is_visible` / `duplicate_of_id` 在查询时过滤，抓取与去重都不动索引。否则一次「下架再上架」就会让帖子和索引脱钩，而抓取因为内容没变不会再写索引，只能等人工发现。
- **`published_year` 单独存一列**：SQLite 没有时区函数，而 `/year/[year]` 要按 `sources.timezone` 取年且走索引，所以抓取时就算好落列；`published_at` 仍是 UTC。不变量：**改 `published_at` 必须同时改 `published_year`**，计算集中在 `src/lib/domain/date.ts`，由 `normalizePost` 单点调用。
- **`summary` 带 CHECK 约束**（`length ≤ 200`）：硬性规则 1 的底线不靠自觉，超了直接写不进库。**200 字是规则上限，不是展示目标**：卡片上按两行裁（`line-clamp`），列表节奏不该被摘要长度带跑。
- **`reading_minutes` / `has_code` 是派生元数据**：前者由正文字符数估算，后者由详情页 HTML 是否含 `<pre>` / `<code>` 判断，都不包含正文片段。它们只服务于卡片上的「N 分钟」「含代码」与筛选，不参与排序。列表页拿不到正文时 `has_code` 保持 NULL（不知道就不显示），不伪装成 false。已有库用 `vpr db:metrics` 从 crawler 私有正文文件回填；这个脚本与 `db:check` 一样只读 crawler 侧文件，web 没有访问路径。
- **`title_norm`** 是跨源去重的比对键（NFKC + 小写 + 只留字母数字汉字），配 `(company_id, title_norm)` 索引，去重不用全表扫。
- **`priority` + `duplicate_of_id`**：官网与掘金重复发布是常态。抓完后按「同公司 + 同 `title_norm` + 3 天内」找碰撞，`priority` 小者胜出，另一条打上 `duplicate_of_id`。**索引不跟着删**——可见性与去重都在查询时过滤（见下一条），去掉这层耦合之后，「下架再上架」「胜出方被删」都不需要补索引。`duplicate_of_id` 是自引用外键，胜出方被删时置空。
- **`crawl_jobs` 是批次层**：跨源去重、批次统计、「这轮要不要重建」需要一个比 `crawl_runs`（每个源一行）更高的维度。
- **`sources.timezone`**：列表页给「无时区时间」的源（有赞是 `28 Oct 2022`）必须按源站时区解释，硬编码 `Asia/Shanghai` 会让收英文源时静默错位。
- **`sources.blocked_at` / `blocked_reason`**：被 robots 或 403 挡住时标记，下一轮直接跳过，需要 `--force` 才重试；解除后自动清空。挡住不等于失败——每天重撞一次只会让源站更反感。

### 保留与清理

| 数据             | 策略                                                                                           |
| :--------------- | :--------------------------------------------------------------------------------------------- |
| 正文文件         | 帖子删除/判重后由 `vpr db:check --prune` 清孤文件；正文单篇入库上限 6 万字（`MAX_BODY_CHARS`） |
| `http_cache`     | 90 天未校验的删掉                                                                              |
| `crawl_failures` | 90 天；`crawl_runs` / `crawl_jobs` 180 天                                                      |
| 下架/删除请求    | `is_visible = 0` **并**删正文文件与 FTS 行，不只是藏起来                                       |

体量参考（实测 21 篇）：SQLite 612 KB（含 FTS），正文 gzip 后 216 KB，约 10 KB/篇。万级文章对应约 100 MB 正文 + 600 MB 库，单机无压力。

---

## 5. 抓取管道

### 分层

```text
调度 → fetchPolite → 适配器解析 → 归一 → 写入（正文文件 + 库 + FTS）→ 收尾（去重）
```

`fetchPolite(url)`（`scripts/crawler/fetch.ts`）是**唯一**能发 HTTP 的地方。限速、robots、条件请求、重试、编码全在这一层，适配器只负责把 HTML/JSON 变成结构化字段。合规因此是结构保证的，不靠每个适配器自觉。

### 传输层

| 关注点     | 做法                                                                                                                                                                                           |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 限速       | 按 **origin** 排队（不是按 source），间隔 ≥1s；robots 的 `Crawl-delay` 更大时取它                                                                                                              |
| robots.txt | 每个 origin 抓一次、进程内缓存 24h，用 `robots-parser`。404/410/200-HTML 兜底页 → 允许；401/403/5xx/429 → 本轮全站禁止（保守）                                                                 |
| UA         | `boguan/0.1 (+https://boguan.dev/about; aggregator; honors robots.txt)`，**必须 ASCII**（HTTP header 不能含中文，否则 fetch 直接抛错），不伪装浏览器                                           |
| 条件请求   | 列表页与详情页都带 `If-None-Match` / `If-Modified-Since`，命中 304 跳过解析并计入 `not_modified`。**这是尽力而为**：实测有赞对相同 ETag 仍返回 200，真正的省请求来自「元数据没变就不进详情页」 |
| 重试       | 只重试「可能是暂时的」：网络错误 / 5xx / 429，最多 3 次指数退避；429 听 `Retry-After`；**403、404 不重试**                                                                                     |
| 编码       | 从 `Content-Type` 与 `<meta charset>` 判定，GBK/GB2312 统一按 GB18030 解（生僻字不变问号）                                                                                                     |
| 超时       | 整体 20s，超时按网络错误进入重试                                                                                                                                                               |
| Cookie     | 永不携带登录态；遇到登录墙/验证码即标记跳过，不绕过                                                                                                                                            |

### 适配器

```ts
interface SourceAdapter {
  slug: string;
  capabilities: { list: "html" | "rss" | "json"; detail: "html" | "json" | "none" };
  pageUrl(listUrl, page): string;
  fetchList(ctx, page): Promise<ListItem[]>; // 空数组 = 没有下一页
  fetchDetail?(ctx, url): Promise<Detail>; // 正文纯文本、作者、标签、绝对时间
}
```

- 新增一个源 = 一个文件 + 一条 `sources` 记录，管道代码不动。
- **解析形态只有一处真相**：`capabilities` 由适配器声明，数据库里不再存 `kind` / `time_from`——“列表页有没有时间”“要不要进详情页”不重复表达。
- **列表页能拿到时间就不进详情页**；列表页能拿到正文（RSS `content:encoded`）就声明 `detail: 'none'`。
- **纯前端渲染的源（掘金、知乎）只走公开 JSON 接口，不引入无头浏览器**。无头浏览器既贵又容易被判定为绕过反爬；拿不到公开接口就标记「暂不支持」，不做。
- **解析失败必须响**：列表页 200 但解析出 0 条、详情页找不到正文容器、正文短于 200 字——都抛错进 `crawl_failures`，不静默写一条空正文。（有赞详情页会让轻量 HTML 解析器丢掉整段正文，所以用 cheerio；这就是「静默失败比崩溃更难查」的实例。）
- **通用格式交给现成库，不自己写胶水**：feed 解析用 `rss-parser`（RSS/Atom 归一、`rel="alternate"`、`content:encoded`、`dc:creator` 都已处理），实体解码用 `entities`（HTML5 命名实体全集）。自己维护一份「实体映射表 / feed 字段归一」只会写出一个覆盖更窄的版本。唯一保留手写的是 HTML → 文本：`htmlToText` 直接遍历已经解析好的 cheerio DOM，而 `html-to-text` 要重新 parse 一遍字符串；这 40 行没有外部状态，留着手写比多一个依赖划算。
- **不用无头浏览器、也不默认上 Readability**：通用可读性抽取（`@mozilla/readability` + jsdom）能减少「一个源一份选择器」的成本，但它对**已知结构**的站点没有收益，还会把导航与评论混进正文。触发条件是「待接源里有一半以上没有稳定结构」，到那时再加 `detail: "auto"` 能力，现在不引。

### 归一

1. **canonical URL**：去掉 `utm_*` / `from` / `spm` 等追踪参数与锚点、参数排序、去末尾斜杠；不改协议、不改 host（不猜源站支不支持 https）。
2. **时间**：带时区偏移的串直接按偏移解析；无时区的串按 `sources.timezone` 解释后转 UTC；**解析失败置 NULL 并保留 `published_at_raw`**。宁可缺失，不要编造——列表按时间倒序时缺的沉底，且不进 `/year` 归档。
3. **摘要**：优先源站 description；没有就从正文截首 200 字，在句首/句末标点处收口，不留半个词、不留 HTML 残留。
4. **正文**：只用纯文本，单篇上限 6 万字；进详情页的源用适配器的容器选择器收敛范围，再由 `htmlToText` 抽文本。
5. **指纹**：`content_hash = sha256(title + summary + 正文)`；`listHash = sha256(title + summary)` 用来判断「要不要再进详情页」。
6. **阅读元数据**：`reading_minutes` 按中文字符数（约 400 字/分钟）与英文词数（约 200 词/分钟）估算，至少 1 分钟；`has_code` 由适配器在原始 HTML 上检测 `<pre>` / `<code>`，不靠纯文本猜。两者都是派生元数据，正文仍然只进 crawler 私有文件与 FTS。

### 去重

- 同源：`canonical_url` 唯一约束。
- 跨源：同公司 + 同 `title_norm` + 3 天内，`priority` 小者胜出；输家打 `duplicate_of_id`。索引与正文都保留，过滤发生在查询里。
- v1 只做这一条规则。已知局限：胜出方被删后不会自动「改判」，需要人工处理。

### 标签

1. **源站标签**先按 `tag_aliases.raw` 查映射；
2. 查不到就按**中文名**找已有标签（源站常有 `big-data` 与 `da-shu-ju` 两个 slug 指同一个「大数据」），找到就补一条别名，不新开标签页；
3. 名字也没有的原始标签**不入库**，记进运行日志（`未映射的源站标签：…`）等人工补映射；
4. 一个源站标签都没解析出来时，退到 `scripts/crawler/rules/tags.ts` 的关键词规则（`origin = 'rule'`）：标题命中直接算数，正文要出现 3 次以上，每篇最多 3 个；
5. 人工干预写 `origin = 'manual'`，自动流程只删非 manual 的标签关联。

`/tags` 的分组（人工智能、数据与检索、架构与稳定性……）是**展示层映射**，写在 `src/lib/domain/tag-group.ts`，不新增数据库列；未知标签落到「其他」，不会因为新增一个标签而消失。

### 失败与可观测

- 单源失败不阻塞其它源；`crawl_runs.status` 区分 `ok` / `partial` / `failed` / `running`。
- 逐 URL 的错误进 `crawl_failures`（stage 区分 list / detail），「哪几篇一直挂」是可查的，不用翻日志。
- **幂等是验收标准**：同样的内容跑第二遍，`inserted` 与 `updated` 必须为 0（实测已验证，见 `docs/SOURCES.md`）。
- `vpr db:check` 做对账：FTS 缺失/脏残留/孤儿、孤正文文件、被挡住的源、最近批次；`--fix` 修索引，`--prune` 清过期数据。

---

## 6. 渲染策略

**静态优先，搜索与筛选按需 SSR。**

| 页面                                         | 渲染方式                   | 索引       |
| :------------------------------------------- | :------------------------- | :--------- |
| `/`、`/company/*`、`/tag/*`、`/year/*`、分页 | 构建时静态生成             | ✅ index   |
| `/search`、带筛选参数的结果页                | SSR（需服务端分词 + FTS5） | ❌ noindex |
| sitemap.xml、robots.txt                      | 构建时生成                 | —          |

列表页的「含代码」筛选入口指向 `/search?has_code=1`（可叠加 company / tag / year）：
静态页读不到查询串，筛选统一在唯一的 SSR 结果页里完成，视觉上仍是同一套卡片与筛选条。

分页同样是静态路由：首页 `/page/[n]`，公司 / 标签 / 年份分别是
`/company/[slug]/page/[n]`、`/tag/[slug]/page/[n]`、`/year/[year]/page/[n]`；第 1 页不带
`/page/1`，避免同一内容两个 URL。

- 每日抓取完成后触发一次重建；列表页最多滞后一天，可接受。
- 搜索是唯一必须动态渲染的页面，因此站点需要 Node 适配器（而非纯静态托管）。
- 关于页用 `BaseLayout` 的 `chrome="bare"`：隐藏侧栏与移动栏，但 `<head>`、canonical、hreflang 仍由 layout 统一维护；页面自己提供顶部导航。不要为它复制一份 head。
- **筛选只能走 SSR**：静态页读不到 `?company=&tag=&year=`。所以「筛选组合页」与搜索一样是 SSR + `noindex`，不要把筛选做成静态路径组合（数量爆炸且都是薄页面）。
- 筛选状态全部在 URL 查询参数里（硬性规则 5），不引入客户端状态。
- **页面只有一个数据库入口**：`src/lib/db/queries`。页面与 endpoint 不许直接 `openReadonlyDatabase`（`guard.test.ts` 守），查找与过滤规则也就不会各写一份。
- **CI 构建用固定数据集**：`vpr db:fixture` 生成 `data/fixture.db`（4 条覆盖「有/无发布时间、两家公司」），
  `BOGUAN_DB=data/fixture.db vpr build`。构建不依赖网络与源站可用性；本地开发则用真实抓取库。

> 实现时以当前 Astro 版本的 `output` / `prerender` 配置语义为准。

---

## 7. 搜索设计

中文分词是这里唯一的难点：SQLite FTS5 默认的 `unicode61` 分词器不切中文，整段中文会被当成单个 token。

**方案**：入库前切词、以空格连接写入 FTS5；查询时对关键词做同样切分。分词器是 `@node-rs/jieba`（napi-rs 预编译，Bun 与 Node 都能用；`nodejieba` 是 node-gyp 原生模块，在 Bun 上不可靠），代码在 `src/lib/search/tokenize.ts`，crawler 与 SSR 搜索共用。索引与查询必须走同一个函数，否则 token 对不上。

```ts
segment("多级缓存架构实践"); // "多级 缓存 架构 实践"
toMatchQuery("缓存 AND 淘汰"); // '"缓存" "AND" "淘汰"' —— 每个 token 都加引号，避免被当成 FTS5 语法
```

### 排序

**相关度优先**：`bm25(posts_fts, 5.0, 1.0)` 升序（SQLite 里越负越相关，标题权重 5、正文 1），同分再按 `published_at` 倒序，最后用 `id` 兜底——**分页必须稳定**，否则同分同时间的条目会跨页重复。

> 不要同时宣称「BM25 标题加权」和「按时间倒序」：排序键只能是其中一种，另一个至多做次级排序键。

### 结果里给什么

`posts_fts` 是 contentless 表：`snippet()` / `highlight()` 返回 `NULL`，列值也读不回来。这恰好和硬性规则 1 对齐——**结果只展示标题、摘要、公司、时间、标签**，不截取正文命中片段。

想告诉用户「为什么命中」，用 FTS5 的列过滤免费判断：

```sql
select rowid from posts_fts where posts_fts match 'title_tokens : ("缓存")'
```

拿它和当前页的 rowid 求交集，就能标出「标题命中 / 正文命中」，不增加任何文本外泄面。

### 其它约定

- 结果过滤 `is_visible = 1 and duplicate_of_id is null`，与列表页同一套可见性规则；过滤放在 SQL 里，不要先 LIMIT 再过滤（会短页）。
- 索引里**有**下架与判重的帖子（索引与可见性解耦，见 §4），所以过滤不能省。
- 查询串上限 120 字；分词后为空（全是符号）直接返回空结果，不要把空 MATCH 放给 FTS5。
- 不做查询语法（不支持用户写 `OR` / 前缀 `*`）：每个 token 都被引号包住当字面量，避免 FTS5 语法注入，也避免用户学习成本。将来要 OR 就在 UI 上做复选框。
- 不使用 FTS5 的 `trigram` 分词器：它要求查询串 ≥ 3 字符，而中文搜索词常为 2 字。
- 只有 `content_hash` 变化才重写索引；换分词器 / 改参数后用 `rebuildAllPostFts` 从正文文件全量重建。

**为什么不用 Meilisearch / Elasticsearch**：多一个服务就多一个部署单元和故障点。当前数据量（万级）FTS5 完全够用。

---

## 8. SEO 与内容策略

聚合站最大的 SEO 风险不是"渲染不出来"，而是**被判为重复内容**。因此：

1. **详情页不存在**。文章卡片直接外链原文，不在本站复制正文。
2. **可索引的是列表页**：公司页、标签页、年份页。这些页面承载了"聚合"本身的独特价值——同一主题下跨公司、跨时间的文章集合，是原文页面没有的。**这是本站的 SEO 资产。**
3. `sitemap.xml` 用 `@astrojs/sitemap` 生成，只收录列表页并带 `hreflang` 互链；搜索页与筛选组合页 `noindex` 且被 `filter` 排除。
4. 每个页面输出唯一的 `<title>`、`description`、`canonical`、OG 标签。
5. 列表页输出 `ItemList` / `CollectionPage` 结构化数据。
6. 外链跳转使用 `rel="noopener"`；如需统计点击，用显式跳转参数而非 `nofollow`。
7. 多语言页面互相声明：每页输出各语言的 `hreflang` 与 `x-default`，canonical 指自己。见 §9。
8. 站内 feed（`/rss.xml`、`/en/rss.xml`）只放**标题 + 摘要 + 原文链接**，与页面同一套内容边界（硬性规则 1）；`BaseLayout` 输出 `<link rel="alternate" type="application/rss+xml">` 便于订阅发现。

---

## 9. 国际化（i18n）

**决策：从第一天就按双语结构开发。界面语言是 zh-CN（默认）+ en；被抓取的文章内容保持原文，不做翻译。**

### 语言与 URL

- 语言清单是唯一事实源：`src/lib/i18n/config.ts` 与 `astro.config.mjs` 的 `i18n.locales` 必须一致（加语言时两处一起改）。
- 默认语言不带前缀，其它语言带前缀，**同一份内容共享 slug**：

| URL                           | 语言  |
| :---------------------------- | :---- |
| `/`、`/company/meituan`       | zh-CN |
| `/en/`、`/en/company/meituan` | en    |

- **一份页面 × 所有语言**：所有页面都写在 `src/pages/[...lang]/` 下，用 `localeRoutes()` 生成 `getStaticPaths`，语言只当参数：

  | 文件                                       | 生成的 URL                                |
  | :----------------------------------------- | :---------------------------------------- |
  | `src/pages/[...lang]/index.astro`          | `/`、`/en/`                               |
  | `src/pages/[...lang]/company/[slug].astro` | `/company/meituan`、`/en/company/meituan` |

  默认语言用 `lang: undefined` 生成无前缀路径，其它语言用 `lang: '<prefix>'`，与 `prefixDefaultLocale: false` 对齐。

- **不为某种语言复制页面文件**。Astro 文档也给了 `src/pages/en/*.astro` 的复制方案，但那样每个页面都得复制数据查询与 `getStaticPaths`，语言越多越容易漂移；而 hreflang 是按路径前缀推的，一漏就是指向 404 的死链。
- hreflang 只声明本页真正生成过的语言（`BaseLayout` 的 `alternateLocales`）。「所有页面都在 `[...lang]/` 下」由 `i18n.test.ts` 的目录约定测试守护。
- 语言切换是普通 `<a>` 链接，路径由 `localizePath()` / `alternateLinks()` 算出，不引入客户端状态。

### 取词

- 唯一的取词入口是 `useTranslations(locale)` 返回的 `t('key')`；文案在 `src/lib/i18n/messages/{locale}.json`，key 用扁平 `area.name` 写法。
- **页面、组件里不写裸字符串**：硬编码的界面文案 CI 管不了，但会在加语言时全部漏掉。
- 缺词不静默：默认语言也没有该 key 时 `t()` 直接抛错让构建失败；其它语言缺 key 回退到 zh-CN（同步由 `i18n:check` 拦截）。
- 品牌名「博观」是常量（`src/lib/site.ts`），不进 messages。

### 内容语言

- 文章标题、摘要、正文永远是原文。`en` 页面把标题包在 `lang="zh-CN"` 的元素里，避免被搜索引擎当成英文内容。
- `en` 版本的价值在界面与浏览结构，不产生「翻译稿」，因此不会与原文构成重复内容竞争。
- 数据层预留 `posts.lang` / `sources.lang`（默认 `zh-CN`）。将来收英文源时，**不要**以为能「按 `lang` 选分词器」：FTS5 的 `tokenizer` 是表级属性，一张表内无法按行切换。正确做法是**按 `lang` 决定是否过 jieba**——英文不切词直接写入，`unicode61` 本来就会按词边界切它。两种语言可以共存于同一列。

### 工具

- `x18n`（devDependency，只做校验，不进运行时）：`vp run i18n:check` 检查缺 key、漏翻、未使用 key，CI 必跑；`vp run i18n:ui` 起浏览器界面批量改文案。
- 语言相关的单元测试在 `src/lib/i18n/i18n.test.ts`（key 对齐、占位符一致、路径前缀互转）。

> **为什么默认语言不带前缀**：中文站的主场是 `/`，也是所有外链与分享的入口。代价是将来更换默认语言需要处理 301，可以接受。

---

## 10. 样式与主题

**决策：原生 CSS + 设计令牌，不引入 Tailwind；亮/暗跟随系统、可手动覆盖且不闪。**

### 为什么是原生 CSS

- 本站是内容型站点，组件很少（导航、卡片、分页、标签），设计是定制的，不是拼现成组件库。
- 无论选哪个方案，颜色都必须走语义令牌；Tailwind 省的是布局类名的书写，代价是多一层 DSL、配置与内容扫描规则。
- Astro 的 `<style>` 本身就是组件作用域样式，配上令牌层已经拿到封装收益，CSS 产物更小、debug 更直接。
- 逃生口：将来组件数量暴涨或引入设计系统，Tailwind v4 可以直接叠在令牌层上，颜色令牌不用改。

### 三层，各管各的

| 层   | 位置                                                  | 谁用                     |
| :--- | :---------------------------------------------------- | :----------------------- |
| 原语 | `src/styles/tokens.css` 的 `--neutral-*`/`--accent-*` | 只有令牌层，组件不直接用 |
| 语义 | 同文件的 `--color-*`                                  | 组件只引用这一层         |
| 组件 | `.astro` 里的 `<style>`                               | 单个组件内部，作用域隔离 |

### 亮/暗只有一套机制

- 令牌用 `light-dark()` 一次写两值：`--color-bg: light-dark(var(--neutral-50), var(--neutral-900))`。
- 切换只靠 `color-scheme`：`:root { color-scheme: light dark }`，`[data-theme="light"|"dark"]` 覆盖它。**不用**「媒体查询改一批令牌 + class 再改一批」的两套写法，那是主题 bug 的常见的源头。
- 无 JS 时跟随系统；`<head>` 里一段内联脚本在首屏绘制前读 `localStorage` 写 `data-theme`，避免白闪。
- 手动选择与系统偏好一致时删掉覆盖，回到「跟随系统」。
- 这是硬性规则 5（不引入客户端全局状态）的**唯一例外**：主题是设备本地偏好，不参与可分享 URL。再加其它本地状态前先改本文。

### 颜色与对比度

- 色值用 `oklch()`，中性色相固定 265、强调色相固定 252，两套主题不换色相。
- 每个角色都有亮/暗两个值，对比度由 `src/styles/tokens.test.ts` 实测（正文 ≥ 4.5:1，边框/分隔 ≥ 1.4:1）。改色后不达标会让测试直接失败，不靠自觉。
- 强调色只承担「可交互」一个含义，不拿来做静态装饰；一个视图只强调一个主动作。

### 排版

- 不加载 Web 字体：中文用系统字体栈（PingFang SC / Microsoft YaHei / Noto Sans CJK），不让字形拖首屏。
- 关于页的展示字体走 `--font-serif`（Noto Serif SC / Songti SC / SimSun 等系统衬线），同样不加载 Web 字体。
- 字号、行高、间距、圆角一律用令牌，组件里不出现裸色值与裸字号。
- 正文按 `--width-measure` 收窄到 60–75 字符，标题 `text-wrap: balance`。

### 关于页的固定纸面

关于页是一张「印刷页」，使用 `src/styles/about.css` 里页面级的 `--about-*` 暖色令牌（纸面、墨色、橄榄绿、赭石），固定为暖色，不跟随全站亮/暗主题；这是版面决策，不是第二套全站主题。它不改变 `--color-*` 的角色定义，也不把暖色带到组件层。`about.css` 只由关于页引入，其他页面不应依赖这些变量。

> 基线：`light-dark()` 与 `oklch()` 需要 2024 年后的浏览器（Chrome 123 / Safari 17.5 / Firefox 120）。本站面向开发者，不再为更老的浏览器降级。

---

## 11. 部署

```
香港轻量云服务器（1C2G 起步）
├── Caddy            自动 HTTPS，反代
├── web (Node)       静态产物 + 搜索 SSR
└── cron             每日：vpr crawl → vpr build → 热加载
```

- **重建触发就用 cron 串行**，不引 webhook：`vpr crawl && vpr db:check --fix --prune && vpr build`，任一步失败就停在原地、留上一版站点继续服务。`db:check` 放在重建之前，保证上线的是对过账的数据。抓取与重建是同一个批次的不同阶段，中间少一个服务就少一个故障点。
- 抓取需要写 `data/boguan.db` 与 `data/bodies/`；web 只需要 `data/boguan.db`（**只读**），不需要挂正文目录——这是硬性规则 1 在部署层的体现。
- SQLite 文件挂载到宿主机卷，定期备份（`sqlite3 .backup` 到对象存储）；`data/bodies/` 一起备份，但丢了也能重抓。
- 首版不引入 CDN、不做多实例；单机足以支撑
- 若后续迁回国内，需要 ICP 备案

---

## 12. 里程碑

| #   | 内容            | 验收标准                                                          | 状态                 |
| :-- | :-------------- | :---------------------------------------------------------------- | :------------------- |
| 0   | 数据源可行性    | 至少 3 家公司可稳定抓到标题/时间/正文，结论记进 `docs/SOURCES.md` | 2 家已验证           |
| 1   | 数据模型 + 管道 | `vpr crawl` 可重复执行且幂等；`vpr db:check` 全绿                 | ✅                   |
| 2   | 只读站点        | 四类列表页可访问，i18n 骨架就位                                   | 进行中（骨架已就位） |
| 3   | 搜索            | 中文两字词可命中，结果相关                                        | 查询层已就绪         |
| 4   | SEO             | sitemap、canonical、hreflang 齐全                                 | 未开始               |
| 5   | 上线            | 域名可访问，每日自动更新                                          | 未开始               |

> 顺序不能跳：阶段 0 的结论会反过来改 schema（`fixtures` 就改过一次 `adapter` / `timezone` / `title_norm`），先做模型再验证源等于给猜测加索引。

## 13. 未决问题

- **第三个数据源**：需要至少再验证一家，才能确认适配器接口与标签规则不是只对「Ghost + VuePress」这两套模板成立的。
- **`--mode=backfill` 的全量回填**：40 页 × 10 篇、≥1s/请求，一次约 7 分钟；还没在真实源上跑完过，抓完要复查标签质量与去重结果。
- **标签的自动程度**：v1 是「源标签映射 + 关键词规则 + 人工维护」。实测有赞的标签云里英语与拼音写法并存（`big-data` / `da-shu-ju` / `bigdata`），靠中文名归并 + 人工别名够用；LLM 抽取留到数据量稳定之后再评估。
- **搜索排序**：现在是「BM25（标题 5 : 正文 1）+ 时间次级」。真实数据上够不够用要等语料变大，尤其是同一主题跨年份的结果。
- **去重的改判**：胜出方被删后，`duplicate_of_id` 指向的记录不会自动复活，需要人工或一个专门的修复脚本。
- **通用正文抽取（Readability）**：暂不引入。触发条件写在这里，避免以后反复讨论——当待接源里超过一半没有稳定的正文容器时，加 `detail: "auto"` 能力，用 `@mozilla/readability`（或 linkedom + 同名算法）兜底，正文过短仍按失败处理。

> 已定下来的（原未决项）：分页深度——增量看水位、回填看 `--max-pages`（§3）；标签来源——规则匹配 + 人工映射（§5）；重建触发——cron 串行 `crawl → build`（§11）。
