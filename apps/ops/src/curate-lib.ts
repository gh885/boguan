import { dedupe, posts, rebuildAllPostFts, type Db, companies } from "@boguan/database/ops";
import {
  contentHash,
  HIDDEN_NON_ARTICLE,
  isNonArticle,
  stripSiteSuffix,
  titleNorm,
} from "@boguan/domain";
import { eq } from "drizzle-orm";
import { openBodyStore } from "@boguan/body-store";

const bodies = openBodyStore();

export interface CurateOptions {
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

  const apply = db.$client.transaction(() => {
    for (const post of db.select().from(posts).all()) {
      const brands = companyBrands.get(post.companyId) ?? [];
      const title = stripSiteSuffix(post.title, brands);

      const body = bodies.read(post.id) ?? "";
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
  });
  if (!dryRun) apply();

  if (report.retitled > 0 && !dryRun) {
    report.indexed = rebuildAllPostFts(db, bodies.read);
    report.duplicates = dedupe(db, log);
  }

  return report;
}
