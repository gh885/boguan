# @boguan/web

## 责任

Astro 页面、组件、布局、样式、i18n、SEO 与 Web 入口。只读 SQLite，不执行抓取，不访问正文存储。

## 技术栈

Bun 1.4、Astro 7、Astro Bun adapter、Drizzle 查询接口、原生 CSS、`@astrojs/sitemap`、`@astrojs/rss`、x18n。

## 约束

- 输出默认静态，搜索与筛选按需 SSR。
- 仅依赖 `@boguan/database/web-read`、`@boguan/domain`、`@boguan/search`。
- 不依赖 crawler、ops、catalog 或 body-store。
- 搜索结果不得输出正文或正文命中片段。
- 页面可见文案必须来自 i18n。
- Bun adapter 的生产构建、SSR、静态资源和部署验证通过后才可用于生产。
