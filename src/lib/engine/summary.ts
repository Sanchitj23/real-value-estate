import { CATEGORIES, type ExportResult, type RuleOutcome } from "./applicability";
import { categorySummary } from "./plain";

// The single "strongest answer" per topic: definite answers first, so one uncertain rule never hides a rule that applies.
const RANK: Record<string, number> = { applies: 5, not_yet_effective: 4, unknown: 3, pending: 2, superseded: 1 };

/** Per-property roll-up used by lists, tables and the map. Per-rule results stay authoritative. */
export function summarize(outcomes: RuleOutcome[]) {
  const cats: Record<string, ExportResult | null> = {};
  for (const c of CATEGORIES) {
    const best = outcomes.filter((o) => o.category === c && o.result).sort((a, b) => (RANK[b.result!] ?? 0) - (RANK[a.result!] ?? 0))[0];
    cats[c] = best?.result ?? null;
  }
  const mixed: Record<string, string[]> = {};
  for (const c of CATEGORIES) mixed[c] = Array.from(new Set(outcomes.filter((o) => o.category === c && o.result).map((o) => o.result!)));
  const plain: Record<string, ReturnType<typeof categorySummary>> = {};
  for (const c of CATEGORIES) plain[c] = categorySummary(outcomes.filter((o) => o.category === c).map((o) => o.result));
  return {
    categories: cats,
    category_results: mixed,
    category_summary: plain,
    reported: outcomes.filter((o) => o.result).length,
    unknown_count: outcomes.filter((o) => o.result === "unknown").length,
    conflict: outcomes.some((o) => o.conflict_flag),
  };
}
