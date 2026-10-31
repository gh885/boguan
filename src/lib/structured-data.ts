import { site } from "./site";

interface Item {
  title: string;
  url: string;
}

/** 首页：WebSite + SearchAction + 最新文章 ItemList */
export function homeJsonLd(
  items: readonly Item[],
  description: string,
  latestName: string,
  searchUrl: string,
  inLanguage: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: site.name,
        url: site.url,
        description,
        inLanguage,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${searchUrl}?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      collectionJsonLd({
        name: latestName,
        description,
        url: site.url,
        items,
      }),
    ],
  };
}

interface CollectionInput {
  name: string;
  description: string;
  url: string;
  items: readonly Item[];
}

/** 公司页 / 标签页 / 年份页 / 分页：CollectionPage + ItemList（外链原文） */
export function collectionJsonLd(input: CollectionInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: input.url,
    isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: input.items.length,
      itemListElement: input.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.title,
        url: item.url,
      })),
    },
  };
}
