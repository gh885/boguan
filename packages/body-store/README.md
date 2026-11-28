# @boguan/body-store

## 责任

crawler 私有正文的压缩文件存储：`data/bodies/<post_id>.txt.gz`，一篇一个文件，gzip 压缩。

对外只暴露一个绑定到目录的 `BodyStore`：写入、读回、存在性、删除、列出 id、按保留集清理。文件名约定、gzip、目录创建、原子写入都封在包内。

## 技术栈

TypeScript strict、`node:fs`、`node:zlib`。无运行时依赖。

## 约束

- 与数据库无关：不 import `@boguan/database`，不读库、不进事务。
- 正文是派生数据：最坏情况能从源站重抓，不做迁移、不做事务补偿。
- 写入先落临时文件再 rename，进程中断只会留下 `.tmp` 或旧文件，不会留下半个 gzip。
- 读失败（文件损坏）返回 `null`，调用方按「没有正文」处理，下一轮重抓覆盖。
- 只有 crawler 与授权的 ops 命令可以依赖本包；Web 不依赖，也就没有正文的访问路径。
