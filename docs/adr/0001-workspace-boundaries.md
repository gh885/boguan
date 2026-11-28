# ADR 0001：Workspace 边界

状态：接受

采用 `web`、`crawler`、`ops` 三个应用包及 `catalog`、`domain`、`search`、`database`、`body-store` 五个共享包。依赖方向由各包 README 定义；Web 无正文与写库能力，Crawler 与 Web 只通过 SQLite 交汇。

安装布局用 `bunfig.toml` 的 `hoisted` linker：打包进产物的原生模块（`@node-rs/jieba`）与 SSR 运行时都从仓库根的 `node_modules` 解析，而运维层的发布产物放在 `$APP/releases` 下、`dist` 是相对软链——依赖根必须是仓库根，不能是某个应用包自己的 `node_modules`。
