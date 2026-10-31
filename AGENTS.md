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

1. **不转载全文。** 页面只渲染标题、摘要（≤ 200 字）、作者、时间、标签、原文链接。正文可以入库用于检索，但**不得完整输出到页面**。
2. **抓取必须守规矩。** 遵守 `robots.txt`，同一域名并发 ≤ 1、请求间隔 ≥ 1s，不携带登录态，不绕过付费墙、验证码或反爬机制。
3. **抓取逻辑只写在与 Web 进程分离的脚本里。** 任何 `src/pages/`、`src/middleware.ts` 中不得执行抓取或长时间任务。
4. **每个可索引页面必须有唯一的 `<title>`、`description` 和 canonical。** 搜索页与任意筛选组合页默认 `noindex`。
5. **不引入客户端全局状态。** 筛选、分页、搜索一律走 URL 查询参数，保证可分享、可索引、可后退。主题偏好的 `localStorage` 是唯一例外（见 `docs/ARCHITECTURE.md` §10）。
6. **不改动 `docs/ARCHITECTURE.md` 中的决策，除非先更新文档并说明理由。**
7. **界面文案必须走 i18n，不得硬编码。** 页面与组件里的可见字符串一律通过 `useTranslations(locale)` 的 `t('key')` 取得，文案存在 `src/lib/i18n/messages/{locale}.json`；新增 key 时同步所有语言并跑 `vpr i18n:check`。

---

## 技术栈与边界

| 层              | 选型                                               |
| :-------------- | :------------------------------------------------- |
| 框架            | Astro 7（默认静态输出，按需 SSR）                  |
| 语言            | TypeScript strict                                  |
| 运行时 / 包管理 | Bun 1.4                                            |
| 工具链          | Vite+（`vp` / `vpx`）                              |
| 数据库          | SQLite + Drizzle ORM                               |
| 检索            | SQLite FTS5，中文先经 nodejieba 分词               |
| 多语言          | `src/lib/i18n`（zh-CN 默认 + en），`x18n` 校验文案 |
| 样式            | 原生 CSS + 设计令牌（`src/styles/`），亮/暗主题    |

依赖方向：`pages → components → lib`。`lib/` 放数据访问与纯函数，禁止在组件里直接拼 SQL。所有数据库访问经由 `src/lib/db/` 暴露的函数。

---

## 目录约定

```text
src/pages/[...lang]/  路由，一份页面 × 所有语言（`localeRoutes()`）
src/layouts/        页面骨架，全局 <head> 在 BaseLayout 统一维护
src/components/     展示组件，不含数据访问
src/lib/i18n/       语言清单、messages、`t()`、路径前缀与日期格式化
src/styles/         设计令牌（tokens.css）、全局基础样式、令牌守卫测试
src/lib/db/         Drizzle schema 与查询函数
src/lib/domain/     纯逻辑：slug、日期、标签归一化、摘要截断
scripts/crawler/    抓取管道，独立进程，不 import 任何 src/ 下的 Astro 代码
docs/               架构与决策
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
vpx scripts/crawler/...  # 运行抓取脚本，替代 tsx
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
- slug 一律小写、短横线连接、不含中文；生成规则写在 `src/lib/domain/slug.ts`。

---

## 编码约定

- 组件优先 `.astro`；只有在确实需要客户端交互时才引入岛屿，并明确写出为什么。
- 数据查询函数返回已确定的类型，类型从 Drizzle schema 推导，不手写重复 interface。
- 日期统一以 UTC 存储，展示时用 `formatDate(value, locale)`（内部按 `Asia/Shanghai`）。
- 站内链接用 `localizePath(path, locale)`，不要在模板里手拼 `/en` 前缀。
- 颜色、字号、行高、间距、圆角一律用令牌（`src/styles/tokens.css`）；组件里不写裸色值和裸字号，也不直接用 `--neutral-*` / `--accent-*` 原语。
- 改颜色：在 `tokens.css` 里给语义色补 `light-dark()` 两值，然后跑 `vp test`（`tokens.test.ts` 实测对比度与单一主题机制）。
- 不要用 `any`；确需逃逸时写 `unknown` + 收窄。
- 提交前跑 `vp check`，构建必须通过 `vpr build`。

---

## 文档

- [`README.md`](README.md) — 项目定位、功能、路线图
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统形状、数据模型、搜索与 SEO 策略、关键决策

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
