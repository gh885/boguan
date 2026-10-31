import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../../src/lib/db/index";
import { upsertPostFts } from "../../src/lib/db/fts";
import { companies, postTags, posts, sources, tags } from "../../src/lib/db/schema";
import { titleNorm } from "../../src/lib/domain/title";

/**
 * 构建用的最小数据集：`vpr db:fixture` → `data/fixture.db`。
 *
 * 为什么需要它：站点是数据驱动的，CI 里不能跑抓取（没网也得能构建，更不该去骚扰源站）。
 * 有了固定数据集，构建在 CI 与本机表现一致，也不会因为某天源站改版而变红。
 *
 * 安全约定：路径固定为 `data/fixture.db`，**不读 `BOGUAN_DB`**——绝不可能覆盖真实的抓取库。
 * 需要让构建用它：`BOGUAN_DB=data/fixture.db vpr build`（CI 就是这么做的）。
 */

const fixturePath = fileURLToPath(new URL("../../data/fixture.db", import.meta.url));
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

rmSync(fixturePath, { force: true });
rmSync(`${fixturePath}-wal`, { force: true });
rmSync(`${fixturePath}-shm`, { force: true });
mkdirSync(dirname(fixturePath), { recursive: true });

const db = openDatabase(fixturePath);
migrate(db, { migrationsFolder });

const meituan = db
  .insert(companies)
  .values({
    slug: "meituan",
    name: "美团",
    nameEn: "Meituan",
    homepage: "https://tech.meituan.com/",
  })
  .returning()
  .get();
const youzan = db
  .insert(companies)
  .values({ slug: "youzan", name: "有赞", nameEn: "Youzan", homepage: "https://tech.youzan.com/" })
  .returning()
  .get();

const meituanSource = db
  .insert(sources)
  .values({
    companyId: meituan.id,
    slug: "meituan-tech-rss",
    name: "美团技术团队",
    adapter: "meituan-rss",
    listUrl: "https://tech.meituan.com/rss.xml",
    priority: 10,
  })
  .returning()
  .get();
const youzanSource = db
  .insert(sources)
  .values({
    companyId: youzan.id,
    slug: "youzan-tech",
    name: "有赞技术团队",
    adapter: "youzan",
    listUrl: "https://tech.youzan.com/",
    priority: 20,
  })
  .returning()
  .get();

const tagRows = [
  { slug: "cache", name: "缓存" },
  { slug: "architecture", name: "架构" },
  { slug: "distributed-systems", name: "分布式系统" },
  { slug: "big-data", name: "大数据" },
].map((tag) => db.insert(tags).values(tag).returning().get());

const fixtures = [
  {
    source: meituanSource,
    company: meituan,
    title: "多级缓存架构实践",
    summary: "从本地缓存到分布式缓存的分层设计与一致性处理，包含热点探测与失效策略。",
    publishedAt: "2024-03-01T02:00:00.000Z",
    publishedYear: 2024,
    author: "美团基础技术部",
    tagSlugs: ["cache", "architecture"],
    body: "本文介绍多级缓存架构的分层设计、热点 key 探测与一致性处理。",
  },
  {
    source: meituanSource,
    company: meituan,
    title: "分布式事务在订单系统的落地",
    summary: "对比 TCC、Saga 与消息最终一致，给出订单链路的选型与补偿设计。",
    publishedAt: "2023-11-20T02:00:00.000Z",
    publishedYear: 2023,
    author: "美团到店事业群",
    tagSlugs: ["distributed-systems", "architecture"],
    body: "订单系统对一致性要求极高，本文对比三种分布式事务方案的取舍。",
  },
  {
    source: youzanSource,
    company: youzan,
    title: "知识库检索匹配的服务化实践",
    summary: "把语义匹配做成通用服务：向量化、召回与排序三段式，以及对长尾 query 的处理。",
    publishedAt: "2022-10-27T16:00:00.000Z",
    publishedYear: 2022,
    author: "liujiwen",
    tagSlugs: ["big-data"],
    body: "知识库检索匹配可以抽象为文本相似度计算，本文介绍服务化的工程实现。",
  },
  {
    // 故意留一条没有发布时间的：列表要「沉底但不消失」，年份归档要跳过它
    source: youzanSource,
    company: youzan,
    title: "没有发布时间的旧文",
    summary: "源站列表页不给时间，用来验证缺时间的渲染与归档行为。",
    publishedAt: null,
    publishedYear: null,
    author: null,
    tagSlugs: ["architecture"],
    body: "这条数据只用于构建期验证。",
  },
];

for (const [index, fixture] of fixtures.entries()) {
  const row = db
    .insert(posts)
    .values({
      sourceId: fixture.source.id,
      companyId: fixture.company.id,
      canonicalUrl: `https://example.com/fixture/${index + 1}`,
      title: fixture.title,
      titleNorm: titleNorm(fixture.title),
      summary: fixture.summary,
      author: fixture.author,
      publishedAt: fixture.publishedAt,
      publishedAtRaw: fixture.publishedAt,
      publishedYear: fixture.publishedYear,
      contentHash: `fixture-${index + 1}`,
    })
    .returning()
    .get();

  upsertPostFts(db, row.id, row.title, fixture.body);

  for (const slug of fixture.tagSlugs) {
    const tag = tagRows.find((candidate) => candidate.slug === slug);
    if (!tag) continue;
    db.insert(postTags).values({ postId: row.id, tagId: tag.id, origin: "rule" }).run();
  }
}

console.log(`构建用数据集就绪：${fixturePath}`);
console.log(`  公司 ${2} / 渠道 ${2} / 帖子 ${fixtures.length} / 标签 ${tagRows.length}`);
console.log("  用它构建：BOGUAN_DB=data/fixture.db vpr build");
