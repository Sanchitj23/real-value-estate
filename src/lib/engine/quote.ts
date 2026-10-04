/**
 * Locate a model-proposed quote in the stored source text.
 * Offsets are UTF-16 code-unit indices into the persisted decoded text (JS string indices).
 * "exact": byte-for-byte substring.
 * "whitespace": matches after collapsing runs of whitespace.
 * "normalized": the same characters in the same order, ignoring all whitespace and treating curly quotes and long
 *   dashes as their plain forms. Captured pages often break a sentence before its full stop or inside a link, and
 *   readers return straight quotes; neither changes a single word.
 * In every case the offsets point into the original text and the stored quote is the original substring.
 * `min` is the shortest quote accepted: 20 characters for the requirement itself; field-level facts such as a
 * status line ("Chaptered", "P.L. 2021, c.110") are naturally shorter and may pass a lower minimum.
 */
export type QuoteMatch = { start: number; end: number; kind: "exact" | "whitespace" | "normalized" };

const PLAIN: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201B": "'", "\u2032": "'", "\u201C": '"', "\u201D": '"', "\u2033": '"',
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
};
type Index = { collapsed: string; collapsedMap: number[]; squashed: string; squashedMap: number[] };
let memo: { text: string; index: Index } | null = null;

function squash(s: string): string {
  let out = "";
  for (let k = 0; k < s.length; k++) { const ch = s[k] ?? ""; if (!/\s/.test(ch) && ch !== "\u200B") out += PLAIN[ch] ?? ch; }
  return out;
}

/** One pass over the source text, reused for every quote checked against the same text. */
function indexOf(text: string): Index {
  if (memo?.text === text) return memo.index;
  const collapsedMap: number[] = [], squashedMap: number[] = [];
  let collapsed = "", squashed = "", prevWs = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k] ?? "";
    if (/\s/.test(ch)) { if (!prevWs) { collapsed += " "; collapsedMap.push(k); } prevWs = true; continue; }
    collapsed += ch; collapsedMap.push(k); prevWs = false;
    if (ch !== "\u200B") { squashed += PLAIN[ch] ?? ch; squashedMap.push(k); }
  }
  const index = { collapsed, collapsedMap, squashed, squashedMap };
  memo = { text, index };
  return index;
}

export function findQuote(text: string, quote: string, min = 20): QuoteMatch | null {
  const q = quote.trim();
  if (q.length < min) return null;
  const i = text.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length, kind: "exact" };
  const ix = indexOf(text);
  const cq = q.replace(/\s+/g, " ");
  const j = ix.collapsed.indexOf(cq);
  if (j >= 0) {
    const start = ix.collapsedMap[j] ?? 0;
    return { start, end: (ix.collapsedMap[j + cq.length - 1] ?? start) + 1, kind: "whitespace" };
  }
  const sq = squash(q);
  if (sq.length < Math.min(16, min)) return null;
  const k = ix.squashed.indexOf(sq);
  if (k < 0) return null;
  const start = ix.squashedMap[k] ?? 0;
  return { start, end: (ix.squashedMap[k + sq.length - 1] ?? start) + 1, kind: "normalized" };
}
