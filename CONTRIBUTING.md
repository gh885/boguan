# 贡献指南

感谢关注博观。这是一个以学习为目的的轻量项目，贡献以**数据源适配器**和**站点体验**为主。

## 开始之前

请先读 [`AGENTS.md`](AGENTS.md) 的「硬性规则」与 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。其中几条是不可协商的：

- 不在页面上输出原文全文
- 抓取遵守 `robots.txt`，同域名并发 ≤ 1、请求间隔 ≥ 1s
- 抓取逻辑只写在独立脚本里，不进入 Web 进程

## 本地开发

```bash
vp install
vpr dev            # http://localhost:4321
vp check           # 提交前必跑
vpr i18n:check     # 文案检查（缺 key / 漏翻 / 未使用）
vpr build
```

改动界面文案时，请同时更新 `src/lib/i18n/messages/zh-CN.json`（源语言）与 `en.json`，取词一律用 `useTranslations(locale)`，不要在页面里硬编码字符串。

## 提交 PR

1. 从 `main` 切出分支，命名如 `feat/meituan-adapter`、`fix/pagination`
2. 改动尽量聚焦，一个 PR 只做一件事
3. 提交信息使用 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:`），中文或英文均可
4. 确保 CI 通过

## 新增数据源

1. 先提 [数据源 Issue](https://github.com/gh885/boguan/issues/new?template=source-request.yml)，确认可抓性与合规性
2. 在 `scripts/crawler/adapters/` 下新增适配器，实现统一接口
3. 在 `sources` 中登记来源，本地跑通增量抓取
4. PR 中附上抓取样本（标题、时间、摘要各若干条），便于 review

## 内容移除

如果希望移除某篇文章或某个来源，请按 [内容移除模板](https://github.com/gh885/boguan/issues/new?template=content-removal.yml) 提交，我们会尽快处理。

## 许可证

贡献的代码以 [MIT](LICENSE) 协议授权。
