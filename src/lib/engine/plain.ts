import { FACTS, type FactKey } from "./expr";

/**
 * Plain-language wording for engine results. Presentation only: nothing here decides whether a rule applies.
 */
export type Tone = "applies" | "unknown" | "future" | "pending" | "superseded" | "none";

export const RESULT_LABEL: Record<string, string> = {
  applies: "Applies",
  unknown: "May apply",
  not_yet_effective: "Starts later",
  pending: "Proposed",
  superseded: "Replaced by a stricter rule",
};
export const RESULT_TONE: Record<string, Tone> = {
  applies: "applies", unknown: "unknown", not_yet_effective: "future", pending: "pending", superseded: "superseded",
};
export const RESULT_HELP: Record<string, string> = {
  applies: "In force and covers this address.",
  unknown: "Could cover this address, but it depends on facts we don't have.",
  not_yet_effective: "Passed into law, but not in effect yet.",
  pending: "A proposal. It is not law.",
  superseded: "Covered, but a stricter rule at another level governs.",
};
export const LIFECYCLE_LABEL: Record<string, string> = {
  in_force: "In force", future: "Starts later", pending: "Proposed — not law", failed: "Struck down or failed",
  repealed: "No longer current", unknown: "Start date unclear",
};
const RANK: Record<string, number> = { applies: 0, not_yet_effective: 1, unknown: 2, pending: 3, superseded: 4 };

/** Sorts rule outcomes so the most definite and most informative come first. */
export function sortOutcomes<T extends { result: string | null; key_value?: string | null }>(outs: T[]): T[] {
  return [...outs].sort((a, b) => (RANK[a.result ?? ""] ?? 9) - (RANK[b.result ?? ""] ?? 9) || Number(!a.key_value) - Number(!b.key_value));
}

/** One-line verdict for a category from its per-rule results. Mixed results stay visible in `parts`. */
export function categorySummary(results: Array<string | null | undefined>): { tone: Tone; headline: string; short: string; parts: string[] } {
  const n = (r: string) => results.filter((x) => x === r).length;
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const applies = n("applies"), may = n("unknown"), later = n("not_yet_effective"), proposed = n("pending"), replaced = n("superseded");
  const parts = [
    applies && plural(applies, "rule applies", "rules apply"),
    may && plural(may, "rule may apply", "rules may apply"),
    later && plural(later, "rule starts later", "rules start later"),
    proposed && plural(proposed, "proposal", "proposals"),
    replaced && plural(replaced, "rule replaced", "rules replaced"),
  ].filter((x): x is string => !!x);
  const tone: Tone = applies ? "applies" : may ? "unknown" : later ? "future" : proposed ? "pending" : replaced ? "superseded" : "none";
  return { tone, headline: parts[0] ?? "No rule found in our sources", short: parts[0]?.replace(/ rules?/, "") ?? "None found", parts };
}

/** Turns an engine "missing" key into a short question a person can act on. */
export function friendlyMissing(m: string): string {
  if (m === "jurisdiction.city") return "Which city the address is legally in (not yet confirmed)";
  if (m.startsWith("manual_review:")) {
    const reason = m.slice("manual_review:".length).trim();
    if (/^coverage is not established/i.test(reason)) return "Whether this property is covered isn't spelled out in the source text";
    if (/^exemptions is not established/i.test(reason)) return "Whether an exemption applies isn't spelled out in the source text";
    const first = reason.split(/(?<=[.;])\s/)[0] ?? reason;
    return first.length > 170 ? `${first.slice(0, 167)}…` : first;
  }
  return FACTS[m as FactKey]?.question ?? m;
}

/** Splits missing items into facts a user can supply and source-text gaps only a reviewer can close. */
export function groupMissing(missing: string[]): { facts: string[]; checks: string[]; generic: string[] } {
  const facts: string[] = [], checks: string[] = [], generic: string[] = [];
  for (const m of Array.from(new Set(missing))) {
    if (!m.startsWith("manual_review:")) facts.push(friendlyMissing(m));
    else if (/is not established by validated evidence/i.test(m)) generic.push(friendlyMissing(m));
    else checks.push(friendlyMissing(m));
  }
  return { facts: Array.from(new Set(facts)), checks: Array.from(new Set(checks)), generic: Array.from(new Set(generic)) };
}
