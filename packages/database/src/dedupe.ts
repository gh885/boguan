import { eq } from "drizzle-orm";
import type { Db } from "./connection";
import { posts } from "./schema";

const DEDUPE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

interface DedupeRow {
  id: number;
  companyId: number;
  titleNorm: string;
  publishedAt: string | null;
  priority: number;
}

function withinWindow(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= DEDUPE_WINDOW_MS;
}

export function dedupe(db: Db, log: (message: string) => void = () => {}): number {
  const rows = db.$client
    .prepare(
      `select p.id as id, p.company_id as companyId, p.title_norm as titleNorm,
              p.published_at as publishedAt, s.priority as priority
       from posts p
       join sources s on s.id = p.source_id
       where p.duplicate_of_id is null and p.is_visible = 1
         and exists (
           select 1 from posts q
           where q.company_id = p.company_id and q.title_norm = p.title_norm and q.id <> p.id
         )
       order by p.company_id, p.title_norm, s.priority asc, coalesce(p.published_at, '') asc, p.id asc`,
    )
    .all() as DedupeRow[];

  let marked = 0;
  let index = 0;
  while (index < rows.length) {
    const group: DedupeRow[] = [];
    const key = `${rows[index].companyId}|${rows[index].titleNorm}`;
    while (index < rows.length && `${rows[index].companyId}|${rows[index].titleNorm}` === key) {
      group.push(rows[index]);
      index += 1;
    }
    if (group.length < 2) continue;

    const winner = group[0];
    for (const loser of group.slice(1)) {
      if (!withinWindow(winner.publishedAt, loser.publishedAt)) continue;
      db.update(posts).set({ duplicateOfId: winner.id }).where(eq(posts.id, loser.id)).run();
      marked += 1;
    }
  }

  if (marked > 0) log(`跨源去重：${marked} 条判为重复（保留官网/高优先级那条）`);
  return marked;
}
