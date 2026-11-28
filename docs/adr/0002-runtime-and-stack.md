# ADR 0002：运行时与基础栈

状态：接受

应用与脚本统一使用 Bun 1.4，脚本以 `bun <file>` 运行；`vpx` 走 Node，不用于本项目脚本。日期解析采用 Luxon。测试统一用 `bun test`（`vpr test`），不保留第二套运行路径。

数据库驱动用 better-sqlite3。SQLite 驱动与 Web 的运行时强绑定：Astro 的构建配置与 SSR 跑在 Node，`bun:sqlite` 会把整条 Web 工具链绑死在 Bun 上，两者混用则是两套驱动。better-sqlite3 在 Node 与 Bun 下是同一份实现，因此全仓一个驱动。

正文文件用 `node:fs` 与 `node:zlib`（Bun 原生实现同一套 API，原子 rename 有同步实现）。

Web 的 SSR adapter 是 `@astrojs/node`（standalone），产物由 `node dist/server/entry.mjs` 起服务。

Bun adapter 实测过三个候选（Astro 7.4 + Bun 1.4.5，Linux 上跑真实构建与冒烟），都不足以换掉现方案：

| 适配器                              |  `/`   | `/en/` | `/companies/` | sitemap | 问题                                                                               |
| :---------------------------------- | :----: | :----: | :-----------: | :-----: | :--------------------------------------------------------------------------------- |
| `@nauverse/astro-bun` 0.1.4         |   ✅   |   ✅   |      ✅       | ❌ 404  | 静态资产清单早于 `@astrojs/sitemap` 生成；Windows 上清单键是反斜杠，预渲染页全 404 |
| `@igloczek/astro-bun-adapter` 1.3.0 | ❌ 404 | ❌ 404 |    ❌ 404     |   ✅    | `trailingSlash: ignore` 下 `/` 与带尾斜杠的 URL 不映射到 index.html                |
| `@wyattjoh/astro-bun-adapter` 2.1.1 |   ✅   | ❌ 404 |    ❌ 404     | ❌ 404  | 上述两类问题各占一半                                                               |

也验证过绕开适配器的路线：`@astrojs/node` 的产物直接用 `bun dist/server/entry.mjs` 跑，全部路由 200（含 sitemap、尾斜杠、404），搜索的 jieba + FTS 正常。性能上换运行时没有收益——同一产物、同一台机器，SSR 搜索 1.7ms/请求（node）对 1.5ms/请求（bun），静态页与启动时间无差别。因此换 adapter 的理由只能是运营简化（服务器少一个运行时），不是性能。

重估触发条件：任一适配器同时满足 `/`、带尾斜杠的 URL、构建后写入的静态文件（sitemap）三条，且不再依赖 Node module runner。

Effect 不作为全仓基础依赖；Crawler 可单独试点。
