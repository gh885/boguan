# AGENTS.md

本文件面向在此仓库工作的 AI 编码助手与人类协作者。**动手前先读完「硬性规则」。**

## 项目

**博观（boguan）**：中文技术团队工程博客索引站。聚合国内互联网公司技术团队博客的元数据，按公司 / 技术标签 / 年份浏览，支持标题与正文检索，阅读时跳转原文。非商业项目，目标是跑通一条完整的轻量全栈链路。

系统由**两个进程**组成：

1. `web` —— Astro 应用，只读数据库，负责渲染与检索
2. `crawler` —— 独立脚本，定时抓取、规范化、写入数据库

两者不共用运行时，不互相调用。

---

## 硬性规则（不可违反）

1. **不转载全文。** 页面只渲染标题、摘要（≤ 200 字）、作者、时间、标签、原文链接。正文只用于检索，**不得输出到页面**——包括**搜索结果的命中片段**（FTS 表是 contentless 的，取不回来是设计，不是缺陷）。正文存储位于 crawler 私有的 `data/bodies/`，web 进程不挂载、不引用。
2. **抓取必须守规矩。** 遵守 `robots.txt`，同一域名并发 ≤ 1、请求间隔 ≥ 1s，不携带登录态，不绕过付费墙、验证码或反爬机制。
3. **抓取逻辑只写在与 Web 进程分离的脚本里。** 任何 `src/pages/`、`src/middleware.ts` 中不得执行抓取或长时间任务。
4. **每个可索引页面必须有唯一的 `<title>`、`description` 和 canonical。** 搜索页与任意筛选组合页默认 `noindex`。
5. **不引入客户端全局状态。** 筛选、分页、搜索一律走 URL 查询参数，保证可分享、可索引、可后退。主题偏好的 `localStorage` 是唯一例外（见 `docs/ARCHITECTURE.md` §10）。
6. **不改动 `docs/ARCHITECTURE.md` 中的决策，除非先更新文档并说明理由。**
7. **界面文案必须走 i18n，不得硬编码。** 页面与组件里的可见字符串一律通过 `useTranslations(locale)` 的 `t('key')` 取得，文案存在 `src/lib/i18n/messages/{locale}.json`；新增 key 时同步所有语言并跑 `vpr i18n:check`。

---

## 技术栈与边界

| 层              | 选型                                                 |
| :-------------- | :--------------------------------------------------- |
| 框架            | Astro 7（默认静态输出，按需 SSR）                    |
| 语言            | TypeScript strict                                    |
| 运行时 / 包管理 | Bun 1.4                                              |
| 工具链          | Vite+（`vp` / `vpx`）                                |
| 数据库          | SQLite + Drizzle ORM                                 |
| 检索            | SQLite FTS5，中文先经 jieba 分词（`@node-rs/jieba`） |
| 多语言          | `src/lib/i18n`（zh-CN 默认 + en），`x18n` 校验文案   |
| 样式            | 原生 CSS + 设计令牌（`src/styles/`），亮/暗主题      |

依赖方向：`pages → components → lib`。`lib/` 放数据访问与纯函数，禁止在组件里直接拼 SQL。所有数据库访问经由 `src/lib/db/` 暴露的函数。

**进程边界（由 `src/lib/db/guard.test.ts` 守）**：

```text
crawler  → src/lib/{db,domain,search}   纯 schema / 纯函数，没有 Astro 依赖
web      → src/lib/db/queries/**        只读查询；页面不许直接 openDatabase
两侧都   ✗ src/pages | src/components | src/layouts
正文     → 只有 scripts/crawler/** 与 scripts/db/** 能引用 src/lib/db/bodies
```

---

## 目录约定

```text
src/pages/[...lang]/  路由，一份页面 × 所有语言（`localeRoutes()`）
src/layouts/        页面骨架，全局 <head> 在 BaseLayout 统一维护
src/components/     展示组件，不含数据访问
src/lib/i18n/       语言清单、messages、`t()`、路径前缀与日期格式化
src/styles/         设计令牌（tokens.css）、全局基础样式、令牌守卫测试
src/lib/db/         Drizzle schema、连接、FTS 同步、正文文件存储、边界守卫测试
src/lib/db/queries/ 列表与搜索的只读查询（页面唯一的数据库入口）
src/lib/search/     分词与查询表达式（jieba，crawler 与 SSR 搜索共用）
src/lib/domain/     纯逻辑：URL 归一、时间解析、摘要截断、标题/标签归一
scripts/crawler/    抓取管道（独立进程）：fetch/robots → adapters → normalize → pipeline
scripts/db/         init（迁移）/ seed（种子数据）/ check（对账与清理）
drizzle/            SQL 迁移（0000 结构由 drizzle-kit 生成，0001 FTS5 手写）
data/               本地数据库与正文文件，不进仓库（`.gitignore`）
docs/               架构与决策（决策看 ARCHITECTURE，源站实测看 SOURCES）
```

---

## 常用命令

```bash
vp install              # 安装依赖
vpr dev              # 开发服务器 :4321
vpr build            # 生产构建
vp check                 # 格式化 + lint + 类型检查（提交前必跑）
vp test                  # 测试
vpr i18n:check           # 校验文案：缺 key、漏翻、未使用 key（CI 必跑）
vpr i18n:ui              # 浏览器里浏览 / 编辑文案
vpr db:generate          # schema.ts 改动后生成 SQL 迁移
vpr db:init              # 建库 / 应用未执行的迁移（幂等）
vpr db:seed              # 写入公司 / 渠道 / 规则标签（幂等）
vpr db:check             # 对账：FTS、孤正文文件、被挡住的源；--fix / --prune
vpr crawl                # 抓取（默认增量）；--dry-run / --mode=backfill / --source=
vpx scripts/...          # 运行脚本，替代 tsx
```

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
/search             站内搜索（noindex）
```

同一套路由在另一种语言下面带前缀，**slug 与语言无关**：

```text
/en/  /en/companies  /en/company/[slug]  /en/tags  /en/tag/[slug]  /en/year/[year]  /en/search
```

- 所有页面都写在 `src/pages/[...lang]/` 下（目录里的 `[...lang]` 就是语言段），用 `localeRoutes()` 生成 `getStaticPaths`：

  ```astro
  export const getStaticPaths = (() => localeRoutes({ slug })) satisfies GetStaticPaths;
  const { locale } = Astro.props; // 不要自己从 URL 猜语言
  ```

- **不要为某种语言复制页面文件**（不要 `src/pages/en/*.astro`，也不要 `src/pages/index.astro`）；目录约定由 `i18n.test.ts` 守。
- 页面只在部分语言下存在时，给 `BaseLayout` 传 `alternateLocales`，否则 hreflang 会指向 404。
- 文章卡片直接外链原文，**v1 不做中转详情页**。若日后需要分享卡片，再加 `noindex` 的预览页。
- slug 一律小写、短横线连接、不含中文；公司 / 渠道 / 标签的 slug 由 seed 或映射表显式给出，`slugify()` 遇到非 ASCII 返回 `null` 就是在要人工指定。

---

## 编码约定

- 组件优先 `.astro`；只有在确实需要客户端交互时才引入岛屿，并明确写出为什么。
- 数据查询函数返回已确定的类型，类型从 Drizzle schema 推导，不手写重复 interface。
- 日期统一以 UTC 存储，展示时用 `formatDate(value, locale)`（内部按 `Asia/Shanghai`）。
- 站内链接用 `localizePath(path, locale)`，不要在模板里手拼 `/en` 前缀。
- 颜色、字号、行高、间距、圆角一律用令牌（`src/styles/tokens.css`）；组件里不写裸色值和裸字号，也不直接用 `--neutral-*` / `--accent-*` 原语。
- 改颜色：在 `tokens.css` 里给语义色补 `light-dark()` 两值，然后跑 `vp test`（`tokens.test.ts` 实测对比度与单一主题机制）。
- 不要用 `any`；确需逃逸时写 `unknown` + 收窄。
- 时间列一律是 ISO 8601 UTC 字符串（`2023-05-12T03:00:00.000Z`）。
- **解析时间走 `src/lib/domain/date.ts`**：源站时间可能是 `28 Oct 2022` / `2026年10月29日` / 无时区，统一由 `parsePublishedAt(raw, sources.timezone)` 处理；解析不出来就存 `NULL`，**不要编造**。
- **`published_year` 是派生列**：改 `published_at` 必须同时改它，计算只经 `yearInTimeZone()`。
- **正文只在 `data/bodies/`**：web 侧不许引用 `src/lib/db/bodies`，也不许读 `posts_fts` 的 `body_tokens`（contentless，读回来是 NULL；`snippet()`/`highlight()` 不可用，搜索结果只给摘要）。
- **跨源去重用 `title_norm`**（`src/lib/domain/title.ts`），不要拿原始标题比字符串。
- **抓取侧发请求只能经 `PoliteFetcher`**：它负责 robots、限速、重试与编码。适配器里不许直接 `fetch`。
- **UA 必须 ASCII**：HTTP header 不能含中文，中文说明放进 `/about` 页面。
- 迁移先改 `src/lib/db/schema.ts` 再 `vpr db:generate`；Drizzle 生成不了的（如 FTS5 虚拟表）用 `vpr db:generate --custom` 手写。已提交的迁移文件只增不改。`vpr db:init` 会自动应用。
- 提交前跑 `vp check`，构建必须通过 `vpr build`。

---

## 文档

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

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
