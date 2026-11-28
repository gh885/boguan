# ADR 0002：运行时与基础栈

状态：接受

应用与脚本统一使用 Bun 1.4，脚本以 `bun <file>` 运行；`vpx` 走 Node，不用于本项目脚本。日期解析采用 Luxon。测试统一用 `bun test`（`vpr test`），不保留第二套运行路径。

数据库驱动用 better-sqlite3。SQLite 驱动与 Web 的运行时强绑定：Astro 的构建配置与 SSR 目前跑在 Node（`@astrojs/node` 是生产回退），`bun:sqlite` 会把整条 Web 工具链绑死在 Bun 上，两者混用则是两套驱动。better-sqlite3 在 Node 与 Bun 下是同一份实现，因此全仓一个驱动。Bun adapter 通过生产验收后重估这一条。

正文文件用 `node:fs` 与 `node:zlib`（Bun 原生实现同一套 API，原子 rename 有同步实现）。

Web 使用 Astro Bun adapter，生产采用前置验收门槛。Effect 不作为全仓基础依赖；Crawler 可单独试点。
