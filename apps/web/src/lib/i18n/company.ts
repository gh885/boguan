import type { Locale } from "./config";

export interface CompanyName {
  name: string;
  nameEn?: string | null;
}

export function companyDisplayName(company: CompanyName, locale: Locale): string {
  if (locale === "en") return company.nameEn?.trim() || company.name;
  return company.name;
}
