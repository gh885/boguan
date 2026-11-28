# @boguan/body-store

## 责任

管理 crawler 私有的正文文件：压缩、读写、删除、列举与孤儿清理。

## 技术栈

Bun 1.4 原生 `Bun.file`、`Bun.write`、`Bun.gzipSync`、`Bun.gunzipSync`；需要原子 rename 时使用 Bun 支持的 `node:fs/promises`。

## 约束

- 不导出给 Web；只有 crawler 和经授权的 Ops 命令可依赖。
- 不依赖数据库；正文存储与元数据事务分离。
- 文件写入采用临时文件与原子替换；损坏正文按缺失处理。
