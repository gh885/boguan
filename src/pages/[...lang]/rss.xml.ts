import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { latestPosts, openWebDatabase } from "../../lib/db/queries";
import { localeRoutes, useTranslations } from "../../lib/i18n";
import type { Locale } from "../../lib/i18n/config";
import { site } from "../../lib/site";

/**
 * 站内 feed：`/rss.xml`（中文）与 `/en/rss.xml`。
 *
 * 聚合站自己的 feed 是「索引」的另一种输出形式，因此**只放标题 + 摘要 + 原文链接**
 * （硬性规则 1）：`description` 就是入库的 `summary`（≤ 200 字），不放正文。
 * 条目按收录时间倒序，与首页的最新流一致。
 */

const FEED_LIMIT = 30;

export const getStaticPaths = () => localeRoutes();

export const GET: APIRoute = ({ props, site: requestSite }) => {
  const { locale } = props as { locale: Locale };
  const t = useTranslations(locale);

  const { items } = latestPosts(openWebDatabase(), { limit: FEED_LIMIT });

  return rss({
    title: t("feed.title"),
    description: t("feed.description"),
    site: requestSite ?? site.url,
    items: items.map((item) => ({
      title: item.title,
      // 外链原文：本站不做中转详情页
      link: item.url,
      description: item.summary,
      pubDate: item.publishedAt ? new Date(item.publishedAt) : undefined,
    })),
    customData: `<language>${locale}</language>`,
  });
};
