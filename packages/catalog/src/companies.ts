export interface CompanyEntry {
  slug: string;
  name: string;
  nameEn?: string;
  homepage?: string;
}

export const COMPANIES: readonly CompanyEntry[] = [
  { slug: "meituan", name: "美团", nameEn: "Meituan", homepage: "https://tech.meituan.com/" },
  { slug: "youzan", name: "有赞", nameEn: "Youzan", homepage: "https://tech.youzan.com/" },
  { slug: "dewu", name: "得物", nameEn: "Dewu", homepage: "https://tech.dewu.com/" },
];
