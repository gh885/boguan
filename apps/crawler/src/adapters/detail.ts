import { load, type CheerioAPI } from "cheerio";
import { htmlToText } from "../extract";
import { requirePageText } from "../fetch";
import type { AdapterContext } from "./types";

/** 正文短于这个长度就当作解析失败，而不是「一篇很短的文章」 */
export const MIN_BODY_CHARS = 200;

export interface DetailContent {
  $: CheerioAPI;
  /** 容器节点的 innerHTML，供 hasCodeInHtml 用 */
  contentHtml: string;
  /** 容器节点的纯文本正文 */
  body: string;
}

/**
 * 详情页抓取样板：取页 → 解析 → 取容器 → 纯文本正文，解析不到或正文过短就抛错
 * （宁可让这一条进 `crawl_failures`，也不要静默入一条空正文）。
 *
 * 详情页**不走条件请求**：拿到 304 时手里没有正文可算指纹，而需要进详情页的场景
 * （新条目 / 元数据变了 / 正文文件丢了）本来就极少重复——省下的流量远抵不上空转。
 */
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
