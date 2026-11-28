export interface TagAliasEntry {
  raw: string;
  slug: string;
}

export const TAG_ALIASES: readonly TagAliasEntry[] = [
  { raw: "bigdata", slug: "big-data" },
  { raw: "big data", slug: "big-data" },
  { raw: "大前端", slug: "frontend" },
  { raw: "测试", slug: "testing" },
  { raw: "java", slug: "java" },
  { raw: "golang", slug: "golang" },
  { raw: "ai&数据", slug: "ai" },
  { raw: "运维&稳定生产", slug: "reliability" },
  { raw: "技术思考", slug: "engineering" },
  { raw: "音视频", slug: "media" },
];
