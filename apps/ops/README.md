# @boguan/ops

## 责任

数据库初始化、迁移、种子、对账、清洗、派生指标回填与 fixture 等运维命令。

## 技术栈

Bun 1.4、TypeScript strict、Drizzle Kit、Commander。

## 约束

- 数据库操作只通过 `@boguan/database/ops`。
- 清洗与归一规则来自 `@boguan/domain`；静态初始数据来自 `@boguan/catalog`。
- 需要处理正文文件的命令才可依赖 `@boguan/body-store`。
- 不依赖 Astro 或 crawler 编排；不得复制业务规则。
- fixture 操作不得覆盖真实数据库。
