# ADR 0003：源码零注释

状态：接受

源码不写注释；决策写入 `docs/adr/`，ADR 从简。理由写在提交说明、ADR 与包 README 里，代码只表达行为。

范围：

- `.ts` / `.astro` / `.css` / `.mjs` 一律不含行注释、块注释与 HTML 注释。
- 编译指令不是注释，保留：`/// <reference types="..." />`、`// @ts-check`、`// @ts-expect-error`。
- 已提交的 SQL 迁移只增不改，其中的 `--` 说明随迁移冻结，不再清理。
- `deploy/` 下的 shell 与 CI YAML 例外：那些注释是运维手册的一部分，跑之前得看懂它在做什么。

守这条规则的是仓库根的 `architecture.test.ts`：它扫描 `apps/` 与 `packages/` 下的源文件，发现注释就让测试失败，不靠自觉。
