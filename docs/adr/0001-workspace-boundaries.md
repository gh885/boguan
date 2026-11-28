# ADR 0001：Workspace 边界

状态：接受

采用 `web`、`crawler`、`ops` 三个应用包及 `catalog`、`domain`、`search`、`database`、`body-store` 五个共享包。依赖方向由各包 README 定义；Web 无正文与写库能力，Crawler 与 Web 只通过 SQLite 交汇。
