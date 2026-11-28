# @boguan/database

## 责任

拥有 SQLite schema、迁移、连接策略、FTS 持久化与所有数据库查询/命令。

## 技术栈

Bun 1.4、`bun:sqlite`、Drizzle ORM / Drizzle Kit、SQLite FTS5。

## 公开能力

- `@boguan/database/web-read`：Web 只读连接与页面/搜索查询。
- `@boguan/database/crawler`：Crawler 读写接口。
- `@boguan/database/ops`：迁移、维护、对账与管理接口。
- `@boguan/database/schema`：仅供迁移、测试与需要 schema 类型的包使用。

## 约束

- Web 入口不导出写连接、维护接口或正文文件路径。
- 连接与 Drizzle schema 为内部实现；应用通过能力接口访问数据。
- 写操作通过事务保持数据库不变量；FTS5 自定义迁移与普通 schema 迁移同属本包所有。
- 不拥有正文文件，不依赖应用包；可依赖 `@boguan/search` 与 `@boguan/domain`。
