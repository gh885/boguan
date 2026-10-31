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

因此：`crawler` 不 import 任何 Astro 代码，`web` 不执行任何抓取。二者只通过数据库交汇。

---

## 3. 数据流

1. 调度器按源遍历，每个源记录 `last_run_at`
2. 拉取列表页（支持 ETag / If-Modified-Since）
3. 解析出条目：标题、URL、发布时间、摘要、作者
4. 按 canonical URL 去重，计算内容哈希判断是否更新
5. 详情页只抓取**摘要与正文**用于检索，不抓图片
6. 标签归一化（见 §7）
7. 写库，写入 `crawl_runs`
8. 全部源完成后，触发 `web` 重建（静态列表页）
9. 失败重试：单源最多 3 次，指数退避；失败不阻塞其他源

---

## 4. 数据模型（草案）

```text
companies
  id            integer pk
  slug          text unique       -- meituan
  name          text              -- 美团
  name_en       text?
  homepage      text?
  logo_url      text?

sources                        -- 一个公司可能有多个发布渠道
  id            integer pk
  company_id    integer fk
  name          text             -- 美团技术团队
  slug          text unique
  list_url      text
  adapter       text             -- 适配器标识，对应 scripts/crawler/adapters/*
  enabled       boolean
  last_run_at   text?

posts
  id            integer pk
  source_id     integer fk
  company_id    integer fk
  canonical_url text unique
  title         text
  summary       text             -- ≤ 200 字，页面展示用
  author        text?
  published_at  text             -- ISO 8601, UTC
  cover_url     text?
  content_hash  text             -- 用于判断更新
  first_seen_at text
  last_seen_at  text
  is_visible    boolean          -- 下线/移除请求置 false

tags
  id            integer pk
  slug          text unique
  name          text

post_tags
  post_id       integer fk
  tag_id        integer fk
  primary key (post_id, tag_id)

crawl_runs
  id            integer pk
  source_id     integer fk
  started_at    text
  finished_at   text?
  status        text             -- running | ok | failed
  total         integer
  inserted      integer
  updated       integer
  error         text?

posts_fts                      -- FTS5 虚拟表，正文只在此存在
  post_id       UNINDEXED
  title_tokens  text             -- 中文已分词
  body_tokens   text             -- 中文已分词
```

**关键约束**：`posts` 表**不存正文**。正文只在检索时使用，写入 `posts_fts` 后即可丢弃，避免任何形式的全文对外暴露。

---

## 5. 抓取管道

### 适配器接口

每个数据源一个适配器，返回统一的中间结构：

```ts
interface SourceAdapter {
  slug: string;
  fetchList(ctx): Promise<ListItem[]>; // 标题、URL、时间、摘要
  fetchDetail?(url, ctx): Promise<Detail>; // 正文（仅用于检索）
  normalize(raw): NormalizedPost;
}
```

- 新增一个源 = 新增一个文件 + 一条 `sources` 记录，不改动框架代码。
- 列表页无法拿到发布时间的源，允许走详情页补齐；顺序可配置。

### 去重与更新

- **主键**：`canonical_url`（去掉 utm、锚点，统一协议与末尾斜杠）
- **更新判定**：`content_hash = sha256(title + summary + published_at + 正文)`
- 哈希未变则只更新 `last_seen_at`

### 限速与礼貌

- 同域名并发 1，请求间隔 ≥ 1s（可配置）
- 遵守 `robots.txt`，不抓取被禁止的路径
- 不伪造 UA，使用可识别的 UA 串
- 不携带 cookie / 登录态

---

## 6. 渲染策略

**静态优先，搜索按需 SSR。**

| 页面                                         | 渲染方式                   | 索引       |
| :------------------------------------------- | :------------------------- | :--------- |
| `/`、`/company/*`、`/tag/*`、`/year/*`、分页 | 构建时静态生成             | ✅ index   |
| `/search`                                    | SSR（需服务端分词 + FTS5） | ❌ noindex |
| sitemap.xml、robots.txt                      | 构建时生成                 | —          |

- 每日抓取完成后触发一次重建；列表页最多滞后一天，可接受。
- 搜索是唯一必须动态渲染的页面，因此站点需要 Node 适配器（而非纯静态托管）。
- 筛选通过 URL 查询参数表达（`?company=&tag=&year=`），不引入客户端状态。筛选结果的组合页**默认不索引**，避免大量薄页面稀释权重。

> 实现时以当前 Astro 版本的 `output` / `prerender` 配置语义为准。

---

## 7. 搜索设计

中文分词是这里唯一的难点：SQLite FTS5 默认的 `unicode61` 分词器不切中文，整段中文会被当成单个 token。

**方案**：入库前用 `nodejieba` 切词，以空格连接写入 FTS5；查询时对关键词做同样切分。

```ts
// 写入
const tokens = jieba.cut(text).join(" ");
// 查询：把 "缓存 淘汰" 切成 "缓存 淘汰"，用 AND / OR 组合
```

- 标题与正文分列索引，BM25 中给标题更高权重
- 不使用 FTS5 的 `trigram` 分词器：它要求查询串 ≥ 3 字符，而中文搜索词常为 2 字
- 结果按 `published_at` 倒序，可按公司二次过滤

**为什么不用 Meilisearch / Elasticsearch**：多一个服务就多一个部署单元和故障点。当前数据量（万级）FTS5 完全够用。

---

## 8. SEO 与内容策略

聚合站最大的 SEO 风险不是"渲染不出来"，而是**被判为重复内容**。因此：

1. **详情页不存在**。文章卡片直接外链原文，不在本站复制正文。
2. **可索引的是列表页**：公司页、标签页、年份页。这些页面承载了"聚合"本身的独特价值——同一主题下跨公司、跨时间的文章集合，是原文页面没有的。**这是本站的 SEO 资产。**
3. `sitemap.xml` 只收录列表页；搜索页与筛选组合页 `noindex`。
4. 每个页面输出唯一的 `<title>`、`description`、`canonical`、OG 标签。
5. 列表页输出 `ItemList` / `CollectionPage` 结构化数据。
6. 外链跳转使用 `rel="noopener"`；如需统计点击，用显式跳转参数而非 `nofollow`。

---

## 9. 部署

```
香港轻量云服务器（1C2G 起步）
├── Caddy            自动 HTTPS，反代
├── web (Node)       静态产物 + 搜索 SSR
└── cron            每日抓取 → 重建 → 重启/刷新
```

- SQLite 文件挂载到宿主机卷，定期备份（`sqlite3 .backup` 到对象存储）
- 抓取任务在容器内或宿主机 cron 触发
- 首版不引入 CDN、不做多实例；单机足以支撑
- 若后续迁回国内，需要 ICP 备案

---

## 10. 里程碑

| #   | 内容            | 验收标准                         |
| :-- | :-------------- | :------------------------------- |
| 0   | 数据源可行性    | 3 家公司可稳定抓到标题/时间/正文 |
| 1   | 数据模型 + 管道 | `vpr crawl` 可重复执行且幂等     |
| 2   | 只读站点        | 四类列表页可访问，构建通过       |
| 3   | 搜索            | 中文两字词可命中，结果相关       |
| 4   | SEO             | sitemap、canonical、JSON-LD 齐全 |
| 5   | 上线            | 域名可访问，每日自动更新         |

---

## 11. 未决问题

- **标签来源**：源站自带标签 / 规则匹配 / LLM 抽取。倾向 v1 规则匹配 + 人工维护映射表。
- **数据源可抓性**：掘金、公众号、知乎等渠道的抓取稳定性需逐个验证，优先有 RSS 或静态 HTML 的站点。
- **分页深度**：是否允许爬虫翻到第 N 页，如何避免抓取成本失控。
- **样式方案**：Tailwind 还是原生 CSS。
- **历史回填**：是否一次性导入各站历史文章，还是只从上线日开始增量。
