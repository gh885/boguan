import { latestPosts, openWebDatabase } from "@boguan/database/web-read";
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { localeRoutes, useTranslations } from "../../lib/i18n";
import type { Locale } from "../../lib/i18n/config";
import { site } from "../../lib/site";

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
      link: item.url,
      description: item.summary,
      pubDate: item.publishedAt ? new Date(item.publishedAt) : undefined,
    })),
    customData: `<language>${locale}</language>`,
  });
};
