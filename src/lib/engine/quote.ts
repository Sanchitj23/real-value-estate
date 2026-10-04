/**
 * Locate a model-proposed quote in the stored source text.
 * Offsets are UTF-16 code-unit indices into the persisted decoded text (JS string indices).
 * "exact": byte-for-byte substring. "whitespace": matches after collapsing runs of whitespace;
 * offsets still point into the original text and the stored quote is the original substring.
 */
export function findQuote(text: string, quote: string): { start: number; end: number; kind: "exact" | "whitespace" } | null {
  const q = quote.trim();
  if (q.length < 20) return null;
  const i = text.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length, kind: "exact" };
  // Build collapsed text with index map
  const map: number[] = [];
  let collapsed = "";
  let prevWs = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    const ws = /\s/.test(ch);
    if (ws) { if (!prevWs) { collapsed += " "; map.push(k); } prevWs = true; }
    else { collapsed += ch; map.push(k); prevWs = false; }
  }
  const cq = q.replace(/\s+/g, " ");
  const j = collapsed.indexOf(cq);
  if (j < 0) return null;
  const start = map[j];
  const end = map[j + cq.length - 1] + 1;
  return { start, end, kind: "whitespace" };
}
