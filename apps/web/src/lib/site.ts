/** 站点级常量。与语言无关，不放进 messages。 */
export const site = {
  /** 品牌名，各语言都不翻译。 */
  name: "博观",
  url: "https://boguan.org.cn",
  repo: "https://github.com/gh885/boguan",
  issues: "https://github.com/gh885/boguan/issues",
  /**
   * ICP 备案号，法规要求展示在页脚并链接到工信部备案系统。
   * 备案号是官方固定字符串，不翻译、不进 messages。
   */
  icp: "晋ICP备2026019879号",
  icpUrl: "https://beian.miit.gov.cn/",
} as const;
