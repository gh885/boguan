import type { Locale } from "./config";

export interface CompanyName {
  name: string;
  nameEn?: string | null;
}

/**
 * 公司名是界面标签，不是文章内容：英文界面优先用 `nameEn`，没有就退回中文名。
 * 文章标题与摘要永远保持原文，不经过这里。
 */
export function companyDisplayName(company: CompanyName, locale: Locale): string {
  if (locale === "en") return company.nameEn?.trim() || company.name;
  return company.name;
}
