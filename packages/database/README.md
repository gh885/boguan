# @boguan/database

## 责任

SQLite 的 schema、迁移与全部读写能力。单一包、按能力分入口，调用方只能拿到自己那一份：

| 入口                        | 给谁                              | 内容                                  |
| :-------------------------- | :-------------------------------- | :------------------------------------ |
| `@boguan/database/web-read` | Web（页面、endpoint、构建与 SSR） | 只读连接 + 列表与检索查询             |
| `@boguan/database/crawler`  | crawler                           | 读写连接 + 表 + FTS 写入              |
| `@boguan/database/ops`      | ops                               | 读写连接 + 迁移 + FTS 对账与重建 + 表 |
| `@boguan/database`          | 需要表定义的只读场景              | 表对象                                |

`web-read` 不导出读写连接，也不导出 FTS 写入：页面拿不到写库能力，不是靠自律。

## 技术栈

better-sqlite3、Drizzle ORM、SQLite FTS5（虚拟表为手写迁移）。迁移文件在 `drizzle/`。

## 约束

- 时间列一律 ISO 8601 UTC 字符串；`published_year` 是派生列，与 `published_at` 同时更新。
- `posts_fts` 是 contentless 表：列值读不回来，`snippet()` / `highlight()` 不可用；token 列只在本包出现。
- 索引与可见性解耦：每篇帖子都有一行索引，`is_visible` / `duplicate_of_id` 在查询时过滤。
- 不依赖任何应用包，也不依赖 `@boguan/body-store`（正文不在这张库里）。
- 已提交的迁移只增不改。
