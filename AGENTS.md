# AGENTS.md

本文件面向在此仓库工作的 AI 编码助手与人类协作者。**动手前先读完「硬性规则」。**

## 项目

**博观（boguan）**：中文技术团队工程博客索引站。聚合国内互联网公司技术团队博客的元数据，按公司 / 技术标签 / 年份浏览，支持标题与正文检索，阅读时跳转原文。非商业项目，目标是跑通一条完整的轻量全栈链路。

系统由两个应用和运维命令组成：

1. `@boguan/web` —— Astro + Bun，只读数据库，负责渲染与检索
2. `@boguan/crawler` —— Bun 独立进程，定时抓取、规范化、写入数据库
3. `@boguan/ops` —— Bun 运维命令，执行迁移、种子、对账与维护

Web 与 crawler 不互相调用，只通过 SQLite 交汇。

---

## 硬性规则（不可违反）

1. **不转载全文。** 页面只渲染标题、摘要（≤ 200 字）、作者、时间、标签、原文链接。正文只用于检索，**不得输出到页面**——包括**搜索结果的命中片段**（FTS 表是 contentless 的，取不回来是设计，不是缺陷）。正文存储位于 crawler 私有的 `@boguan/body-store`，web 进程不挂载、不引用。
2. **抓取必须守规矩。** 遵守 `robots.txt`，同一域名并发 ≤ 1、请求间隔 ≥ 1s，不携带登录态，不绕过付费墙、验证码或反爬机制。
3. **抓取逻辑只写在与 Web 进程分离的 crawler 应用里。** Web 页面不得执行抓取或长时间任务。
4. **每个可索引页面必须有唯一的 `<title>`、`description` 和 canonical。** 搜索页与任意筛选组合页默认 `noindex`。
5. **不引入客户端全局状态。** 筛选、分页、搜索一律走 URL 查询参数，保证可分享、可索引、可后退。主题偏好的 `localStorage` 与经授权的匿名 RUM 标识/会话存储是明确例外（见 `docs/ARCHITECTURE.md` §10）；RUM 不得承载业务状态。
6. **不改动 `docs/ARCHITECTURE.md` 中的决策，除非先更新文档并说明理由。**
7. **界面文案必须走 i18n，不得硬编码。** 页面与组件里的可见字符串一律通过 `useTranslations(locale)` 的 `t('key')` 取得，文案存在 Web 包的 messages 目录；新增 key 时同步所有语言并跑 `vpr i18n:check`。

---

## 技术栈与边界

| 层              | 选型                                                    |
| :-------------- | :------------------------------------------------------ |
| 框架            | Astro 7（默认静态输出，按需 SSR）                       |
| 语言            | TypeScript strict                                       |
| 运行时 / 包管理 | Bun 1.4                                                 |
| 工具链          | Vite+（`vp` / `vpr`）                                   |
| 数据库          | SQLite + better-sqlite3 + Drizzle ORM                   |
| 检索            | SQLite FTS5，中文先经 jieba 分词（`@node-rs/jieba`）    |
| 日期            | Luxon（解析与时区计算）；展示使用 `Intl`                |
| 多语言          | `apps/web/src/lib/i18n`（zh-CN 默认 + en），`x18n` 校验 |
| 样式            | 原生 CSS + 设计令牌（`apps/web/src/styles/`）           |

工作区包的职责、技术栈、公开接口与依赖约束记录于包内 README；包边界决策见 `docs/adr/`。应用仅通过公开入口依赖包能力，不跨包访问内部源码。

```text
web      → database/web-read, domain, search
crawler  → database/crawler, domain, search, catalog, body-store
ops      → database/ops, domain, catalog, body-store
数据库   → domain, search
search   → domain
domain / catalog / body-store → 不依赖其他包
正文     → crawler 与授权的 ops 命令可用；web 不可依赖
```

---

## 工作区目录

```text
apps/web/            Astro 页面、组件、布局、i18n、样式与 Web 入口
apps/crawler/        抓取传输、适配器、管道与 crawler 入口
apps/ops/            数据库迁移、种子、对账与维护命令
packages/catalog/    代码管理的采集配置
packages/domain/     无 I/O 的业务规则
packages/search/     分词与 FTS 查询表达式
packages/database/   schema、迁移、查询与能力接口
packages/body-store/ crawler 私有正文文件能力
data/                本地数据库与正文文件，不进仓库（`.gitignore`）
docs/adr/            简短架构决策记录
docs/                系统架构与数据源实测结论
```

---

## 常用命令

```bash
vp install               # 安装 workspace 依赖
vpr dev                  # 开发服务器 :4321
vpr build                # 生产构建（需要数据库，见下）
vp check                 # 格式化 + lint + 类型检查
vpr test                 # 测试（底层是 bun test）
vpr i18n:check           # 校验文案：缺 key、漏翻、未使用 key
vpr i18n:ui              # 浏览器里浏览 / 编辑文案
vpr db:generate          # 生成数据库迁移
vpr db:init              # 应用未执行的迁移
vpr db:seed              # 写入代码管理的初始目录数据
vpr db:fixture           # 生成构建用 data/fixture.db
vpr db:curate            # 应用存量文章清洗规则
vpr db:check             # 对账 FTS、正文文件与运行状态
vpr db:metrics           # 回填阅读时长与代码标记
vpr crawl                # 抓取；支持 --dry-run / --mode / --source
```

构建需要数据库：本地用真实抓取库；只有构建数据时用
`vpr db:fixture && BOGUAN_DB=data/fixture.db vpr build`（CI 就是这么做的，构建不依赖网络）。

需要后台运行开发服务器时：

```bash
vpr dev --background   # 启动
vpr dev status         # 状态
vpr dev logs           # 日志
vpr dev stop           # 停止
```

---

## Git 工作流

`main` 受规则集保护：**不能直接 push、不能 force push**，改动必须走 Pull Request，且 CI 检查（`检查与构建`）通过后才能合并。

1. 从最新 `main` 切分支：`feat/xxx`、`fix/xxx`、`docs/xxx`、`chore/xxx`
2. 本地先跑 `vp check` 与 `vpr build`
3. push 分支并通过 `gh pr create` 开 PR，等 CI 全绿后再合并（squash）
4. 不要直接向 `main` 提交，也不要为了绕过检查而使用管理员权限

---

## 路由约定

```text
/                   首页（最新文章流）
/companies          公司索引
/company/[slug]     公司页
/tags               标签索引
/tag/[slug]         标签页
/year/[year]        年份归档
/editions           合订本（按期回看的目录）
/edition/[n]        某期版面（一期 = 一个自然日，期号连续；薄期 noindex）
/page/[n]           首页分页（公司 / 标签 / 年份 / 期页下的分页同构）
/search             站内搜索（noindex）
```

同一套路由在另一种语言下面带前缀，**slug 与语言无关**：

```text
/en/  /en/companies  /en/company/[slug]  /en/tags  /en/tag/[slug]  /en/year/[year]  /en/editions  /en/edition/[n]  /en/search
```

- 所有页面都写在 `apps/web/src/pages/[...lang]/` 下（目录里的 `[...lang]` 就是语言段），用 `localeRoutes()` 生成 `getStaticPaths`：

  ```astro
  export const getStaticPaths = (() => localeRoutes({ slug })) satisfies GetStaticPaths;
  const { locale } = Astro.props; // 不要自己从 URL 猜语言
  ```

- **不要为某种语言复制页面文件**；路由目录约定由 Web 包的契约测试守护。
- 页面只在部分语言下存在时，给 `BaseLayout` 传 `alternateLocales`，否则 hreflang 会指向 404。
- 文章卡片直接外链原文，**v1 不做中转详情页**。若日后需要分享卡片，再加 `noindex` 的预览页。
- slug 一律小写、短横线连接、不含中文；公司 / 渠道 / 标签的 slug 由 seed 或映射表显式给出，`slugify()` 遇到非 ASCII 返回 `null` 就是在要人工指定。

---

## 编码约定

- 组件优先 `.astro`；只有在确实需要客户端交互时才引入岛屿。
- 源码零注释：仓库源码不得含行注释、块注释或 HTML/CSS 注释，由根目录 `architecture.test.ts` 守。决策写入 `docs/adr/`，ADR 能短则短；编译指令（`/// <reference>`、`@ts-check`）保留。
- 数据查询函数返回已确定的类型，类型从 Drizzle schema 推导，不手写重复 interface。
- 日期统一以 UTC 存储，展示时用 `formatDate(value, locale)`（内部按 `Asia/Shanghai`）。
- 站内链接用 `localizePath(path, locale)`，不要在模板里手拼 `/en` 前缀。
- 颜色、字号、行高、间距、圆角一律使用 Web 包的设计令牌；组件里不写裸色值和裸字号，也不直接用 `--neutral-*` / `--accent-*` 原语。
- 改颜色：在 `tokens.css` 里给语义色补 `light-dark()` 两值，然后跑 `vpr test`（`tokens.test.ts` 实测对比度与单一主题机制）。
- 不要用 `any`；确需逃逸时写 `unknown` + 收窄。
- 时间列一律是 ISO 8601 UTC 字符串（`2023-05-12T03:00:00.000Z`）。
- **解析时间走 `@boguan/domain`**：源站时间可能是 `28 Oct 2022` / `2026年10月29日` / 无时区，统一由 `parsePublishedAt(raw, sources.timezone)` 处理；解析不出来就存 `NULL`，**不要编造**。
- **`published_year` 是派生列**：改 `published_at` 必须同时改它，计算只经 `yearInTimeZone()`。
- **正文只由 `@boguan/body-store` 持有**：Web 包不得依赖它，也不得读 `posts_fts` 的正文列；搜索结果只给摘要。
- **清洗规则只写一份**（`@boguan/domain`）：标题站点后缀、非文章页判定；入库与 `db:curate` 共用。
- **改标题必须重算 `content_hash`**，否则下一轮抓取会把整批当成「内容变了」。`vpr db:curate` 会核对这一项。
- **薄标签页（< 3 篇）是 `noindex, follow`**，页面与 sitemap 共用 domain 包的门槛；标题比较使用归一后的标题，不直接比较原始标题。
- **抓取侧发请求只能经 `PoliteFetcher`**：它负责 robots、限速、重试与编码。适配器里不许直接 `fetch`。
- **通用格式不手写解析**：feed 用 `rss-parser`，HTML 用 cheerio + `entities`。新增「实体映射表」「feed 字段归一」这类胶水前先看依赖里是不是已经有。
- **页面与 endpoint 只能通过 `@boguan/database/web-read` 读库**，不得取得写库或维护接口。
- **UA 必须 ASCII**：HTTP header 不能含中文，中文说明放在首页的站名与说明里。
- 迁移先改 `@boguan/database` 的 schema，再由 Drizzle Kit 生成；Drizzle 生成不了的（如 FTS5 虚拟表）手写迁移。已提交的迁移文件只增不改；由 Ops 命令应用。
- 脚本一律用 `bun <file>` 运行；`vpx` 走 Node，不用于本项目脚本（`vpr <script>` 只是触发器）。
- 提交前跑 `vp check`，构建必须通过 `vpr build`。

---

## 阿里云平台操作

用户需要操作本项目的阿里云资源时，可以通过浏览器执行其请求范围内的查看、配置和运维操作，无需为已明确授权的步骤重复征求许可。控制台入口为 `https://home.console.aliyun.com/`，优先使用 ego-browser 和用户已有的登录态；开始前读取对应浏览器 skill，不依赖历史 task space ID。登录失效、验证码或 MFA 由用户完成。购买、付费开通、删除资源等操作需有对应的明确授权，本约定不构成无限制授权。

ECS 日常连接使用本机 SSH 别名 `ssh aliyun`；控制台入口、连接配置与验证记录见 [`deploy/README.md`](deploy/README.md#平台操作与服务器连接)。不要将私钥、密码、Cookie 或临时令牌写入仓库或日志。

## 文档

- [`deploy/README.md`](deploy/README.md) — 阿里云操作入口、服务器连接、部署、监控与运维
- [`README.md`](README.md) — 项目定位、功能、路线图
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统形状、数据模型、抓取管道、搜索与 SEO 策略、关键决策
- [`docs/SOURCES.md`](docs/SOURCES.md) — 每个数据源的实测结论、踩过的坑、接入清单

---

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

本项目**不用 `vpx` 跑脚本**：`vpx` 走 Node，而脚本与数据库驱动都在 Bun 上。用 `bun <file>`，例如 `bun apps/ops/src/seed.ts`；`vpr <script>` 只是触发根 `package.json` 里的脚本，不改变运行时。`vp node <file>` 仅用于验证「产物在 Node 上能不能跑」。

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vpr test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
