import { eq } from "drizzle-orm";
import { readBody } from "../../src/lib/db/bodies";
import { rebuildAllPostFts } from "../../src/lib/db/fts";
import type { Db } from "../../src/lib/db/index";
import { companies, posts } from "../../src/lib/db/schema";
import { HIDDEN_NON_ARTICLE, isNonArticle, stripSiteSuffix } from "../../src/lib/domain/curate";
import { titleNorm } from "../../src/lib/domain/title";
import { contentHash } from "../crawler/normalize";
import { dedupe } from "../crawler/pipeline";

/**
 * 把清洗规则应用到**已入库**的数据（ARCHITECTURE §5「清洗」）。
 *
 * 规则本身在 `src/lib/domain/curate.ts`，抓取入库时用的是同一份实现；
 * 这里只负责让存量数据追上规则，可反复跑（幂等）。
 *
 * 三件事：
 * 1. 剥掉标题末尾的站点名后缀（`…｜得物技术`），并重算 `title_norm`（参与跨源去重）
 * 2. `content_hash` 与「标题 + 摘要 + 正文」对不上时重算——改标题必须一起改它，
 *    否则下一轮抓取会把整批当成「内容变了」
 * 3. 把非文章页标成 `is_visible = false` + 记原因（数据保留，可改判）
 */

export interface CurateOptions {
  /** 只报告，不写库 */
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface CurateReport {
  retitled: number;
  rehashed: number;
  hidden: number;
  restored: number;
  indexed: number;
  duplicates: number;
}

export function curate(db: Db, options: CurateOptions = {}): CurateReport {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});

  const companyBrands = new Map(
    db
      .select()
      .from(companies)
      .all()
      .map((company) => [
        company.id,
        [company.name, company.nameEn].filter((name): name is string => !!name),
      ]),
  );

  const tagSlugsByPost = new Map<number, string[]>();
  for (const row of db.$client
    .prepare(
      `select pt.post_id as postId, t.slug as slug
       from post_tags pt join tags t on t.id = pt.tag_id`,
    )
    .all() as { postId: number; slug: string }[]) {
    const list = tagSlugsByPost.get(row.postId) ?? [];
    list.push(row.slug);
    tagSlugsByPost.set(row.postId, list);
  }

  const report: CurateReport = {
    retitled: 0,
    rehashed: 0,
    hidden: 0,
    restored: 0,
    indexed: 0,
    duplicates: 0,
  };

  for (const post of db.select().from(posts).all()) {
    const brands = companyBrands.get(post.companyId) ?? [];
    const title = stripSiteSuffix(post.title, brands);

    // 标题进了 content_hash：改标题就要一起重算
    const body = readBody(post.id) ?? "";
    const hash = contentHash(title, post.summary, body);
    const titleChanged = title !== post.title;
    const hashStale = hash !== post.contentHash;

    if (titleChanged) {
      report.retitled += 1;
      log(`  标题  ${post.title}\n     →  ${title}`);
    } else if (hashStale) {
      report.rehashed += 1;
      log(`  指纹  ${title}（库里的指纹和正文对不上，重算）`);
    }
    if ((titleChanged || hashStale) && !dryRun) {
      db.update(posts)
        .set({ title, titleNorm: titleNorm(title), contentHash: hash })
        .where(eq(posts.id, post.id))
        .run();
    }

    // 人工下架（原因不是 non-article）不碰，规则只管自己那一类
    if (post.hiddenReason && post.hiddenReason !== HIDDEN_NON_ARTICLE) continue;

    const shouldHide = isNonArticle(title, tagSlugsByPost.get(post.id) ?? []);
    if (shouldHide && post.isVisible) {
      report.hidden += 1;
      log(`  下架  ${title}`);
      if (!dryRun) {
        db.update(posts)
          .set({ isVisible: false, hiddenReason: HIDDEN_NON_ARTICLE })
          .where(eq(posts.id, post.id))
          .run();
      }
    } else if (!shouldHide && !post.isVisible) {
      report.restored += 1;
      log(`  恢复  ${title}`);
      if (!dryRun) {
        db.update(posts)
          .set({ isVisible: true, hiddenReason: null })
          .where(eq(posts.id, post.id))
          .run();
      }
    }
  }

  // 标题变了就要重算索引：FTS 是 contentless，改不了单列，只能整表重建（正文从私有文件读）
  if (report.retitled > 0 && !dryRun) {
    report.indexed = rebuildAllPostFts(db, readBody);
    // 标题归一变了，之前的判重结论可能不再成立
    report.duplicates = dedupe(db, log);
  }

  return report;
}
