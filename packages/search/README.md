# @boguan/search

## 责任

提供索引与查询共用的中文分词及 SQLite FTS5 查询表达式。

## 技术栈

TypeScript strict、`@node-rs/jieba`、SQLite FTS5。

## 约束

- 分词与查询表达式仅有一套实现。
- FTS 表结构和 SQL 查询由 `@boguan/database` 所有。
- 不依赖数据库连接、文件系统、网络或应用包。
