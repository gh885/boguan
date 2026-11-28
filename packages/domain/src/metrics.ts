const CODE_TAG = /<(?:pre|code)\b/i;

export function hasCodeInHtml(html: string): boolean {
  return CODE_TAG.test(html);
}

const CODE_LINE =
  /^\s*(?:import|export|from|const|let|var|function|class|interface|type|enum|def|async|await|return|if|else|for|while|switch|case|try|catch|throw|public|private|protected|static|void|package|func|fn|struct|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|BEGIN|COMMIT)\b|[{};]\s*$|^\s*(?:\/\/|#\s|\/\*|\*\/)/;

export function looksLikeCode(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 3) return false;

  let hits = 0;
  for (const line of lines) if (CODE_LINE.test(line)) hits += 1;

  return hits >= 3 && hits / lines.length >= 0.01;
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD = /[A-Za-z0-9]+/g;

const CJK_CHARS_PER_MINUTE = 400;
const WORDS_PER_MINUTE = 200;

export function readingMinutes(text: string): number | null {
  const plain = text.trim();
  if (!plain) return null;

  const cjk = plain.match(CJK)?.length ?? 0;
  const rest = plain.replace(CJK, " ");
  const words = rest.match(WORD)?.length ?? 0;
  if (cjk === 0 && words === 0) return null;

  return Math.max(1, Math.ceil(cjk / CJK_CHARS_PER_MINUTE + words / WORDS_PER_MINUTE));
}
