import { load, type CheerioAPI } from "cheerio";
import { htmlToText } from "../extract";
import { requirePageText } from "../fetch";
import type { AdapterContext } from "./types";

export const MIN_BODY_CHARS = 200;

export interface DetailContent {
  $: CheerioAPI;
  contentHtml: string;
  body: string;
}

export async function fetchDetailContent(
  ctx: AdapterContext,
  url: string,
  selector: string,
): Promise<DetailContent> {
  const response = await ctx.fetcher.page(url, { conditional: false });
  const html = requirePageText(response, `详情页（${url}）`);
  if (html === null) throw new Error(`详情页未变化但本地没有正文：${url}`);

  const $ = load(html);
  const content = $(selector).first();
  if (content.length === 0) throw new Error(`详情页缺少 ${selector}：${url}`);

  const contentHtml = content.html() ?? "";
  const body = htmlToText(contentHtml);
  if (body.length < MIN_BODY_CHARS) {
    throw new Error(`详情页正文只有 ${body.length} 字，选择器可能失效：${url}`);
  }
  return { $, contentHtml, body };
}
