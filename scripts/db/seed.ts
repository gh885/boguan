import { openDatabase, companies, sources, tagAliases, tags } from "@boguan/database/ops";
import {
  allRuleTags,
  COMPANIES,
  DEFAULT_SOURCE_LANG,
  DEFAULT_SOURCE_TIME_ZONE,
  SOURCES,
  TAG_ALIASES,
} from "@boguan/catalog";
import { eq } from "drizzle-orm";

const db = openDatabase();

const companyIdBySlug = new Map<string, number>();

for (const company of COMPANIES) {
  const row = db
    .insert(companies)
    .values({
      slug: company.slug,
      name: company.name,
      nameEn: company.nameEn ?? null,
      homepage: company.homepage ?? null,
    })
    .onConflictDoUpdate({
      target: companies.slug,
      set: { name: company.name, nameEn: company.nameEn ?? null },
    })
    .returning()
    .get();
  companyIdBySlug.set(company.slug, row.id);
}

for (const source of SOURCES) {
  const companyId = companyIdBySlug.get(source.companySlug);
  if (!companyId) throw new Error(`源 ${source.slug} 指向了不存在的公司 ${source.companySlug}`);
  db.insert(sources)
    .values({
      companyId,
      slug: source.slug,
      name: source.name,
      adapter: source.adapter,
      listUrl: source.listUrl,
      timezone: source.timezone ?? DEFAULT_SOURCE_TIME_ZONE,
      lang: source.lang ?? DEFAULT_SOURCE_LANG,
      priority: source.priority ?? 100,
    })
    .onConflictDoUpdate({
      target: sources.slug,
      set: {
        name: source.name,
        adapter: source.adapter,
        listUrl: source.listUrl,
      },
    })
    .run();
}

const ruleTags = allRuleTags();

for (const tag of ruleTags) {
  db.insert(tags)
    .values({ slug: tag.slug, name: tag.name })
    .onConflictDoUpdate({ target: tags.slug, set: { name: tag.name } })
    .run();
}

for (const alias of TAG_ALIASES) {
  const tag = db.select().from(tags).where(eq(tags.slug, alias.slug)).get();
  if (!tag) continue;
  db.insert(tagAliases)
    .values({ raw: alias.raw, tagId: tag.id, source: "manual" })
    .onConflictDoUpdate({ target: tagAliases.raw, set: { tagId: tag.id, source: "manual" } })
    .run();
}

console.log(
  `种子数据就绪：公司 ${COMPANIES.length} 个 / 渠道 ${SOURCES.length} 个 / 规则标签 ${ruleTags.length} 个`,
);
console.log("下一步：vpr crawl --dry-run 看解析对不对，再 vpr crawl --mode=backfill 回填历史。");
