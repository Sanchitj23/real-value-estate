import { CATEGORIES, CATEGORY_LABEL, type RuleOutcome } from "./applicability";
import { categorySummary, groupMissing, sortOutcomes, type Tone } from "./plain";

/** Where an insight can send the reader next. The UI turns this into a link. */
export type InsightLink =
  | { kind: "property"; addressId: string; label: string }
  | { kind: "rule"; id: string; label: string }
  | { kind: "map"; address?: string; layer?: string; label: string }
  | { kind: "changes"; label: string }
  | { kind: "list"; q: string; label: string };

export type Insight = { tone: Tone; title: string; detail: string; link?: InsightLink };

type Detailed = RuleOutcome & { requirement?: string; starts?: string | null };
const clip = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Turns one property's engine results into a short, ordered list a person can act on: what applies now, what to
 * check to settle a "may apply", what starts later or is only proposed, and where our sources have nothing.
 * Presentation only; every statement comes from an engine outcome.
 */
export function propertyInsights(input: { addressId: string; legalCity: string | null; outcomes: Detailed[] }): { headline: string; insights: Insight[] } {
  const outs = input.outcomes.filter((o) => o.result);
  const insights: Insight[] = [];
  const overall = categorySummary(outs.map((o) => o.result));

  // One line per topic that has a definite rule, led by its headline figure.
  const applies = sortOutcomes(outs.filter((o) => o.result === "applies"));
  const seen = new Set<string>();
  for (const o of applies) {
    if (seen.has(o.category) || seen.size >= 4) continue;
    seen.add(o.category);
    const more = applies.filter((x) => x.category === o.category).length - 1;
    insights.push({ tone: "applies", title: `${CATEGORY_LABEL[o.category]}: ${o.key_value ?? o.title}`, detail: `${clip(o.requirement ?? o.title, 170)}${more > 0 ? ` Plus ${more} more rule${more === 1 ? "" : "s"} on this topic.` : ""}`, link: { kind: "rule", id: o.rule_id, label: "See the legal text" } });
  }

  for (const o of outs.filter((x) => x.result === "not_yet_effective").slice(0, 2)) {
    insights.push({ tone: "future", title: `Starts ${o.starts ?? "later"}: ${o.title}`, detail: clip(o.requirement ?? "", 170), link: { kind: "rule", id: o.rule_id, label: "See the legal text" } });
  }

  // The few facts that would settle the most "may apply" answers.
  const may = outs.filter((o) => o.result === "unknown");
  if (may.length) {
    const tally = new Map<string, { n: number; example: string }>();
    for (const o of may) {
      const g = groupMissing(o.missing);
      for (const m of [...g.facts, ...g.checks]) { const t = tally.get(m) ?? { n: 0, example: o.title }; t.n++; tally.set(m, t); }
    }
    const top = Array.from(tally.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 3);
    for (const [question, t] of top) insights.push({ tone: "unknown", title: `Check: ${clip(question, 120)}`, detail: `This decides ${t.n} rule${t.n === 1 ? "" : "s"} that may apply here, for example “${clip(t.example, 70)}”.`, link: { kind: "property", addressId: input.addressId, label: "See those rules" } });
    if (!top.length) insights.push({ tone: "unknown", title: `${may.length} rule${may.length === 1 ? "" : "s"} may apply`, detail: "The source text doesn't spell out which properties are covered, so these need a closer look.", link: { kind: "property", addressId: input.addressId, label: "See those rules" } });
  }

  for (const o of outs.filter((x) => x.result === "pending").slice(0, 1)) {
    insights.push({ tone: "pending", title: `Proposed, not law: ${o.title}`, detail: clip(o.requirement ?? "", 150), link: { kind: "rule", id: o.rule_id, label: "See the proposal" } });
  }

  if (!input.legalCity) insights.push({ tone: "unknown", title: "The legal city isn't confirmed yet", detail: "City rules are shown as “may apply” until the address is placed. The mailing city isn't used as proof." });

  const gaps = CATEGORIES.filter((c) => !outs.some((o) => o.category === c)).map((c) => CATEGORY_LABEL[c]);
  if (gaps.length && outs.length) insights.push({ tone: "none", title: `Nothing found on: ${gaps.join(", ")}`, detail: "A gap in the legal texts we have, not a finding that no law exists." });

  return { headline: outs.length ? overall.parts.join(" · ") : "No rules to show for this address yet", insights };
}
