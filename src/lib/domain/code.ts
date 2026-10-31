/**
 * 代码块检测。
 *
 * - 新抓取：适配器在原始 HTML 上调用 `hasCodeInHtml`，`<pre>` / `<code>` 一个就够；
 *   这比在纯文本里猜可靠（正文里的 `{` 不等于代码）。
 * - 已有库：`vpr db:metrics` 只有 crawler 私有的纯文本正文，用 `looksLikeCode` 做保守回填；
 *   误判只影响一个筛选条件，不会把正文带到页面上。
 */

const CODE_TAG = /<(?:pre|code)\b/i;

export function hasCodeInHtml(html: string): boolean {
  return CODE_TAG.test(html);
}

const CODE_LINE =
  /^\s*(?:import|export|from|const|let|var|function|class|interface|type|enum|def|async|await|return|if|else|for|while|switch|case|try|catch|throw|public|private|protected|static|void|package|func|fn|struct|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|BEGIN|COMMIT)\b|[{};]\s*$|^\s*(?:\/\/|#\s|\/\*|\*\/)/;

/**
 * 纯文本回填用的启发式：至少 3 行命中代码特征，且命中行占比不低于 1%。
 * 阈值刻意保守——把散文里的括号当成代码，会让「包含代码」筛选失去意义。
 */
export function looksLikeCode(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 3) return false;

  let hits = 0;
  for (const line of lines) if (CODE_LINE.test(line)) hits += 1;

  return hits >= 3 && hits / lines.length >= 0.01;
}
