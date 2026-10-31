/**
 * `/tags` 的分组只影响展示，不写数据库：标签本身仍然由抓取与人工映射产生。
 * 新增标签时把它放进合适的组即可；忘了放也不会消失，会落到「其他」。
 */

export type TagGroupId =
  | "ai"
  | "data"
  | "architecture"
  | "engineering"
  | "frontend"
  | "security"
  | "other";

export interface TagGroupDefinition {
  id: TagGroupId;
  slugs: readonly string[];
}

export const TAG_GROUPS: readonly TagGroupDefinition[] = [
  {
    id: "ai",
    slugs: [
      "ai",
      "algorithm",
      "machine-learning",
      "nlp",
      "ji-qi-xue-xi",
      "dui-bi-xue-xi",
      "fen-bu-shi-xun-lian",
      "xiang-liang-hua",
      "suan-fa-ping-tai",
    ],
  },
  {
    id: "data",
    slugs: [
      "big-data",
      "database",
      "jian-suo",
      "zhi-shi-ku",
      "sou-suo",
      "luo-ji-biao",
      "tong-shu-ju-fu-wu",
    ],
  },
  {
    id: "architecture",
    slugs: [
      "architecture",
      "distributed-systems",
      "reliability",
      "performance",
      "observability",
      "cache",
      "middleware",
      "backend",
    ],
  },
  {
    id: "engineering",
    slugs: ["project-management", "xiao-neng-gai-jin", "testing", "engineering"],
  },
  { id: "frontend", slugs: ["frontend", "mobile"] },
  { id: "security", slugs: ["security"] },
] as const;

const groupOfSlug = new Map<string, TagGroupId>();
for (const group of TAG_GROUPS) {
  for (const slug of group.slugs) groupOfSlug.set(slug, group.id);
}

export function tagGroupOf(slug: string): TagGroupId {
  return groupOfSlug.get(slug) ?? "other";
}

export interface TagLike {
  slug: string;
  name: string;
  count: number;
}

export interface TagGroup<T extends TagLike> {
  id: TagGroupId;
  count: number;
  tags: T[];
}

/** 组内保持调用方给的顺序（标签索引按文章数倒序），组之间按 TAG_GROUPS 的顺序。 */
export function groupTags<T extends TagLike>(tags: readonly T[]): TagGroup<T>[] {
  const buckets = new Map<TagGroupId, T[]>();
  for (const tag of tags) {
    const id = tagGroupOf(tag.slug);
    const bucket = buckets.get(id) ?? [];
    bucket.push(tag);
    buckets.set(id, bucket);
  }

  return [...TAG_GROUPS.map((group) => group.id), "other" as const]
    .map((id) => {
      const list = buckets.get(id) ?? [];
      return { id, count: list.length, tags: list };
    })
    .filter((group) => group.tags.length > 0);
}
