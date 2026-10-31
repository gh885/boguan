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

| 功能                               | 状态   |
| :--------------------------------- | :----- |
| 首页文章流（按发布时间倒序）       | 规划中 |
| 按公司筛选                         | 规划中 |
| 按技术标签筛选                     | 规划中 |
| 按年份归档                         | 规划中 |
| 标题 + 正文全文搜索                | 规划中 |
| 点击跳转原文                       | 规划中 |
| 定时增量抓取                       | 规划中 |
| SEO：sitemap / JSON-LD / canonical | 规划中 |

> 当前仓库还是脚手架状态，页面与数据层尚未开始实现。

---

## 技术栈

| 层              | 选型                                | 状态      |
| :-------------- | :---------------------------------- | :-------- |
| 框架            | Astro 7（静态优先，按需 SSR）       | ✅ 已就绪 |
| 语言            | TypeScript（strict）                | ✅ 已就绪 |
| 运行时 / 包管理 | Bun 1.4                             | ✅ 已就绪 |
| 工具链          | Vite+（`vp` / `vpr` / `vpx`）       | ✅ 已就绪 |
| 数据库          | SQLite                              | 规划中    |
| ORM             | Drizzle                             | 规划中    |
| 全文检索        | SQLite FTS5 + 中文分词（nodejieba） | 规划中    |
| 样式            | 待定（Tailwind 或原生 CSS）         | 规划中    |
| 抓取管道        | 独立 TS 进程（不跑在 Web 进程里）   | 规划中    |
| 部署            | 单台轻量云服务器 + Docker + Caddy   | 规划中    |

为什么是 Astro：这是一个以**只读内容**为主、SEO 权重很高的站点，Astro 默认输出零 JS 的静态 HTML，是这类产品的最优解。交互（筛选、搜索）通过 URL 参数驱动，不需要客户端状态。

架构与关键决策见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 项目结构

```text
boguan/
├── public/                 # 静态资源（favicon 等）
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

| 阶段 | 目标            | 产出                                           |
| :--- | :-------------- | :--------------------------------------------- |
| 0    | 验证数据源      | 手动跑通 3 家公司的抓取与解析                  |
| 1    | 数据模型 + 管道 | 表结构、source adapter 接口、去重、抓取日志    |
| 2    | 只读站点        | 首页 / 公司 / 标签 / 年份页面，SSR 或 SSG 输出 |
| 3    | 搜索            | 中文分词入库 + FTS5 查询，搜索页 noindex       |
| 4    | SEO 补齐        | head 元信息、JSON-LD、sitemap、canonical、OG   |
| 5    | 上线            | Docker + Caddy + 定时任务 + 一键部署           |

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
