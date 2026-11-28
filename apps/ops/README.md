# @boguan/ops

## 责任

运维命令：建库与迁移、种子、构建用 fixture、存量清洗、对账与维护、阅读元数据回填。每个命令一个入口文件，由仓库根的 `db:*` 脚本触发。

| 入口             | 命令         | 作用                                      |
| :--------------- | :----------- | :---------------------------------------- |
| `src/init.ts`    | `db:init`    | 应用未执行的迁移（幂等）                  |
| `src/seed.ts`    | `db:seed`    | 写入 `@boguan/catalog` 的目录数据（幂等） |
| `src/fixture.ts` | `db:fixture` | 生成 `data/fixture.db` 供 CI 构建         |
| `src/curate.ts`  | `db:curate`  | 把清洗规则应用到存量数据                  |
| `src/check.ts`   | `db:check`   | 对账索引、正文文件与运行状态              |
| `src/metrics.ts` | `db:metrics` | 从正文文件回填阅读时长与代码标记          |

## 技术栈

Bun、Drizzle ORM、Drizzle Kit；@boguan/database、@boguan/domain、@boguan/catalog、@boguan/body-store。

## 约束

- 只经 `@boguan/database/ops` 访问数据库；不 import 其他应用的内部实现。
- 命令幂等：同一份数据跑第二遍不产生新写入。
- 种子只覆盖代码里有真相的字段，不冲掉运行态（`enabled` / `priority` / `blocked_*`）。
- 正文只读 `@boguan/body-store`，不把正文内容写进库或日志。
