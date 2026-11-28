# ADR 0002：运行时与基础栈

状态：接受

应用与脚本统一使用 Bun 1.4。数据库采用 Drizzle + `bun:sqlite` + SQLite FTS5；日期解析采用 Luxon；正文文件优先使用 Bun 原生 API。Web 使用 Astro Bun adapter，生产采用前置验收门槛。Effect 不作为全仓基础依赖；Crawler 可单独试点。
