/**
 * 关键词打标规则（docs/ARCHITECTURE.md §5「标签」）。
 *
 * v1 不用 LLM：规则可解释、可离线重跑、改一条就能看到影响面。
 * 判定阈值刻意保守——宁可少打一个标签，也不要在列表页上出现「这篇跟缓存有什么关系」。
 */

export interface TagDef {
  slug: string;
  name: string;
}

interface Rule extends TagDef {
  patterns: RegExp[];
  /** 同分时的优先顺序，数字小的先出 */
  order: number;
}

/** 标签清单就是这里的并集；新增标签只改这个文件 */
export const TAG_RULES: Rule[] = [
  {
    slug: "cache",
    name: "缓存",
    order: 1,
    patterns: [/缓存/i, /cache(?!-)\b/i, /redis/i, /memcach/i],
  },
  {
    slug: "distributed-systems",
    name: "分布式系统",
    order: 2,
    patterns: [/分布式/i, /一致性/i, /共识算法/i, /raft/i, /paxos/i],
  },
  {
    slug: "database",
    name: "数据库",
    order: 3,
    patterns: [/数据库/i, /mysql/i, /postgres/i, /tidb/i, /sql\b/i, /索引优化/i],
  },
  {
    slug: "backend",
    name: "后端",
    order: 4,
    patterns: [/后端/i, /服务端/i, /微服务/i, /rpc\b/i, /接口设计/i],
  },
  {
    slug: "frontend",
    name: "前端",
    order: 5,
    patterns: [/前端/i, /浏览器/i, /javascript/i, /typescript/i, /react\b/i, /vue\b/i, /css\b/i],
  },
  {
    slug: "mobile",
    name: "移动端",
    order: 6,
    patterns: [/移动端/i, /客户端/i, /android/i, /ios\b/i, /flutter/i, /小程序/i],
  },
  {
    slug: "architecture",
    name: "架构",
    order: 7,
    patterns: [/架构/i, /系统设计/i, /技术选型/i, /重构/i, /领域驱动/i],
  },
  {
    slug: "ai",
    name: "人工智能",
    order: 8,
    patterns: [/\bai\b/i, /大模型/i, /\bllm\b/i, /机器学习/i, /深度学习/i, /神经网络/i, /\bnlp\b/i],
  },
  {
    slug: "big-data",
    name: "大数据",
    order: 9,
    patterns: [/大数据/i, /数据仓库/i, /数仓/i, /flink/i, /spark\b/i, /hadoop/i, /数据血缘/i],
  },
  {
    slug: "middleware",
    name: "中间件",
    order: 10,
    patterns: [/中间件/i, /消息队列/i, /kafka/i, /rocketmq/i, /rpc 框架/i],
  },
  {
    slug: "performance",
    name: "性能",
    order: 11,
    patterns: [/性能优化/i, /性能/i, /延迟优化/i, /吞吐/i, /压测/i],
  },
  {
    slug: "reliability",
    name: "稳定性",
    order: 12,
    patterns: [/稳定性/i, /高可用/i, /故障/i, /容灾/i, /降级/i, /限流/i],
  },
  {
    slug: "observability",
    name: "可观测",
    order: 13,
    patterns: [/监控/i, /可观测/i, /链路追踪/i, /日志系统/i, /指标/i],
  },
  {
    slug: "security",
    name: "安全",
    order: 14,
    patterns: [/安全/i, /风控/i, /加密/i, /渗透测试/i, /漏洞/i],
  },
  {
    slug: "testing",
    name: "测试",
    order: 15,
    patterns: [/单元测试/i, /自动化测试/i, /质量保障/i, /测试用例/i],
  },
  {
    slug: "engineering",
    name: "工程效能",
    order: 16,
    patterns: [/研发效率/i, /工程效能/i, /持续集成/i, /\bci\b/i, /\bcd\b/i, /devops/i],
  },
  {
    slug: "algorithm",
    name: "算法",
    order: 17,
    patterns: [/算法/i, /数据结构/i, /复杂度/i, /图计算/i, /向量检索/i],
  },
];

/** 正文里出现几次才算命中：一次可能只是顺带提了一句 */
const BODY_THRESHOLD = 3;

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("i") ? "gi" : "g");
  return [...text.matchAll(global)].length;
}

/**
 * 按标题/摘要/正文打标签。标题命中直接算数；正文里要反复出现才计入。
 * 最多返回 `limit` 个，避免每篇都挂七八个标签、标签页退化成全站列表。
 */
export function ruleTags(title: string, summary: string, body: string, limit = 3): TagDef[] {
  const bodyText = `${summary}\n${body}`;
  const scored: { rule: Rule; score: number }[] = [];

  for (const rule of TAG_RULES) {
    const titleHit = rule.patterns.some((pattern) => pattern.test(title));
    if (titleHit) {
      scored.push({ rule, score: 100 - rule.order });
      continue;
    }
    const hits = rule.patterns.reduce((sum, pattern) => sum + countMatches(bodyText, pattern), 0);
    if (hits >= BODY_THRESHOLD) scored.push({ rule, score: hits - rule.order * 0.01 });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ rule }) => ({ slug: rule.slug, name: rule.name }));
}

/** 规则标签的 slug 清单，seed 用它预建标签行 */
export function allRuleTags(): TagDef[] {
  return TAG_RULES.map(({ slug, name }) => ({ slug, name }));
}
