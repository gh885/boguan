# 博观 · boguan

[![CI](https://github.com/gh885/boguan/actions/workflows/ci.yml/badge.svg)](https://github.com/gh885/boguan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 博观而约取。

中文技术团队工程博客索引。把分散在各家互联网公司技术团队博客里的文章，汇聚到一处，按公司、技术标签、年份浏览与检索；阅读时跳转原文。

```
https://boguan.dev
```

---

## 这是什么

- 一个**索引站**，不是一个**转载站**。本站只保存标题、作者、发布时间、摘要、标签和原文链接，**不对外提供原文全文**。
- 目标读者：想系统追踪国内一线互联网公司（字节、阿里、美团、腾讯、快手、小红书……）工程实践的开发者。
- 非商业项目。它的目标是跑通一条完整的轻量全栈链路：**数据采集 → 规范化入库 → 站点渲染 → 搜索 → 部署运维**。

## 不是什么

- 不做全文转载，不镜像原文，不绕过任何站点的访问限制
- 不做社区、评论、点赞、用户账号
- 不追求商业化与流量增长

---

## 功能规划

| 功能                               | 状态      |
| :--------------------------------- | :-------- |
| 首页文章流（按发布时间倒序）       | 规划中    |
| 按公司筛选                         | 规划中    |
| 按技术标签筛选                     | 规划中    |
| 按年份归档                         | 规划中    |
| 标题 + 正文全文搜索                | 规划中    |
| 点击跳转原文                       | 规划中    |
| 定时增量抓取                       | 规划中    |
| SEO：sitemap / JSON-LD / canonical | 规划中    |
| 双语界面（zh-CN 默认 / en）        | ✅ 已就绪 |
| 亮/暗模式（跟随系统 + 手动切换）   | ✅ 已就绪 |

> 当前进度：页面骨架、i18n、设计令牌已就位；数据模型、抓取管道（美团 RSS + 有赞 HTML）、中文检索查询层已跑通并有测试。**列表页尚未实现**——现在只有首页占位。

---

## 技术栈

| 层              | 选型                              | 状态          |
| :-------------- | :-------------------------------- | :------------ |
| 框架            | Astro 7（静态优先，按需 SSR）     | ✅ 已就绪     |
| 语言            | TypeScript（strict）              | ✅ 已就绪     |
| 运行时 / 包管理 | Bun 1.4                           | ✅ 已就绪     |
| 工具链          | Vite+（`vp` / `vpr` / `vpx`）     | ✅ 已就绪     |
| 数据库          | SQLite                            | ✅ 已就绪     |
| ORM             | Drizzle                           | ✅ 已就绪     |
| 全文检索        | SQLite FTS5 + 中文分词（jieba）   | ✅ 查询可用   |
| 多语言          | `src/lib/i18n` + `x18n` 文案校验  | ✅ 已就绪     |
| 样式            | 原生 CSS + 设计令牌，亮/暗主题    | ✅ 已就绪     |
| 抓取管道        | 独立 TS 进程（不跑在 Web 进程里） | ✅ 两家源跑通 |
| 部署            | 单台轻量云服务器 + Docker + Caddy | 规划中        |

为什么是 Astro：这是一个以**只读内容**为主、SEO 权重很高的站点，Astro 默认输出零 JS 的静态 HTML，是这类产品的最优解。交互（筛选、搜索）通过 URL 参数驱动，不需要客户端状态。

架构与关键决策见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 项目结构

```text
boguan/
├── public/                 # 静态资源（favicon 等）
├── scripts/
│   ├── crawler/            # 抓取管道：fetch/robots → adapters → normalize → pipeline
│   └── db/                 # init / seed / check
├── drizzle/                # SQL 迁移（FTS5 为手写迁移）
├── data/                   # 本地 SQLite 与正文文件（不进仓库）
├── src/
│   ├── assets/             # 需要被构建处理的资源
│   ├── components/         # 可复用组件（.astro 或岛屿）
│   ├── layouts/            # 页面骨架、全局 head
│   ├── pages/              # 路由：文件即路由
│   └── env.d.ts
├── docs/                   # 架构与决策文档
├── scripts/                # 独立脚本：抓取、导入、维护（规划中）
├── astro.config.mjs
├── vite.config.ts          # Vite+ 配置：fmt / lint
├── package.json
└── AGENTS.md               # 给 AI 助手与协作者的工程约定
```

目录会随实现推进扩展，规划中的布局见 `docs/ARCHITECTURE.md`。

---

## 本地开发

需要 **Bun 1.4+**（`package.json` 的 `devEngines` 已声明）与 **Node 22.23+**。

```bash
vp install         # 安装依赖
vpr dev            # 启动开发服务器 http://localhost:4321
vpr build          # 构建生产产物到 ./dist/
vpr preview        # 本地预览构建产物
```

质量检查（Vite+ 工具链）：

```bash
vp check           # 格式化 + 校验 + 类型检查
vp test            # 运行测试
vpx scripts/foo.ts # 直接运行 TS 脚本（替代 tsx）
```

抓取管道（独立进程，与 Web 无关）：

```bash
vpr db:init                          # 建库 / 应用迁移
vpr db:seed                          # 写入公司、渠道、规则标签
vpr crawl --dry-run                  # 只抓一页、只打印，接入新源时先跑这个
vpr crawl                            # 增量（默认最多翻 5 页）
vpr crawl --mode=backfill --max-pages=20   # 首次接入：回填最近 20 页
vpr crawl --source=youzan-tech       # 只跑一个源
vpr db:check                         # 对账 FTS / 正文文件 / 被挡住的源（--fix / --prune）
# 每日定时任务：vpr crawl && vpr db:check --fix --prune && vpr build
```

抓取守着 `robots.txt`、同域串行、≥1s 间隔、不带登录态；每个源的实测结论与坑记在
[`docs/SOURCES.md`](docs/SOURCES.md)。

AI 助手或需要后台运行开发服务器时：

```bash
vpr dev --background   # 后台启动
vpr dev status         # 查看状态
vpr dev logs           # 查看日志
vpr dev stop           # 停止
```

---

## 数据来源与合规

这一节是硬约束，改动抓取相关代码前请先读。

1. **只聚合元数据。** 入库字段限于：标题、作者、发布时间、摘要（≤200 字）、封面、标签、原文 URL、canonical URL。正文可以为检索建索引，但不得在页面上完整展示。
2. **尊重 robots.txt**，遵守站点条款，不做登录态抓取，不绕过付费墙或反爬机制。
3. **限速。** 同一域名并发 ≤ 1，请求间隔 ≥ 1 秒；支持条件请求（ETag / If-Modified-Since）。
4. **标注来源。** 每个条目都明确展示所属公司与原文链接，跳转时使用 `rel="noopener"`。
5. **可下线。** 任何公司或作者提出移除请求，应当能够按来源一键删除。

---

## 路线图

| 阶段 | 目标            | 产出                                                     |
| :--- | :-------------- | :------------------------------------------------------- |
| 0    | 验证数据源      | 至少 3 家可稳定抓取；已验证 2 家（见 `docs/SOURCES.md`） |
| 1    | 数据模型 + 管道 | ✅ 表结构、适配器、去重、批次日志，幂等已验证            |
| 2    | 只读站点        | 首页 / 公司 / 标签 / 年份页面，SSR 或 SSG 输出           |
| 3    | 搜索            | ✅ 查询层 + 排序 + 索引；搜索页 UI 待做（noindex）       |
| 4    | SEO 补齐        | head 元信息、JSON-LD、sitemap、canonical、OG             |
| 5    | 上线            | Docker + Caddy + 定时任务 + 一键部署                     |

---

## 部署（规划）

- 一台轻量云服务器（首版倾向香港节点，免备案；稳定后再评估迁回国内）
- Docker Compose 编排：Web 容器 + 抓取任务 + Caddy 反向代理（自动 HTTPS）
- 数据库文件随镜像外挂卷，定期备份
- 定时抓取由宿主机 cron 或容器内调度触发，抓取完成后触发站点重建

---

## 相关文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统形状、数据模型、搜索与 SEO 策略
- [`AGENTS.md`](AGENTS.md) — 工程约定（含给 AI 助手的规则）
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 贡献流程与新增数据源指南

## 许可证

[MIT](LICENSE)
