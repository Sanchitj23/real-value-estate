import { effectiveDateOf, evaluateProperty, lifecycleOn, type DateBasis, type PropertyLite, type RelationLite, type ResolutionLite, type RuleLite } from "./applicability";

export type ChangeKind = "upcoming" | "proposed" | "recent" | "struck" | "expired";
export type ChangeInput = { properties: PropertyLite[]; resolutions: Map<string, NonNullable<ResolutionLite>>; rules: RuleLite[]; relations: RelationLite[] };

export type ChangeItem = {
  rule_id: string; rule_key: string; kind: ChangeKind; title: string; jurisdiction: string; state: string; city: string | null; level: string;
  category: string; key_value: string | null; requirement: string; citation: string; source_doc_id: string | null;
  effective_date: string | null; date_derived: boolean; date_basis: DateBasis; expiry_date: string | null; review_state: string;
  /** Sample addresses inside the rule's jurisdiction. */ in_area_ids: string[];
  /** Sample addresses whose legal city is not confirmed, so a city rule might or might not reach them. */ maybe_ids: string[];
};

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Laws that are not simply "in force and unchanged" on the given date: starting later, proposed, recently started,
 * struck down, or no longer current. Uses the same evaluator as every report; "in area" is jurisdiction only and is
 * not a finding that the rule applies to a particular building.
 */
export function lawChangeItems(inp: ChangeInput, asOf: string, recentDays = 365): ChangeItem[] {
  const area = new Map<string, { yes: string[]; maybe: string[] }>();
  for (const p of inp.properties) {
    for (const o of evaluateProperty(p, inp.resolutions.get(p.id) ?? null, inp.rules, inp.relations, asOf)) {
      const a = area.get(o.rule_key) ?? { yes: [], maybe: [] };
      (o.geo === "true" ? a.yes : a.maybe).push(p.address_id);
      area.set(o.rule_key, a);
    }
  }
  const since = shift(asOf, -recentDays);
  const items: ChangeItem[] = [];
  for (const r of inp.rules) {
    if (r.review_state === "invalid") continue;
    const lc = lifecycleOn(r, asOf);
    const eff = effectiveDateOf(r);
    let kind: ChangeKind | null = null;
    if (lc === "future") kind = "upcoming";
    else if (lc === "pending") kind = "proposed";
    else if (lc === "failed") kind = "struck";
    else if (lc === "repealed") kind = "expired";
    else if (lc === "in_force" && eff.date && eff.date.length === 10 && eff.date >= since && eff.date <= asOf) kind = "recent";
    if (!kind) continue;
    const a = area.get(r.rule_key) ?? { yes: [], maybe: [] };
    items.push({
      rule_id: r.id, rule_key: r.rule_key, kind, title: r.title, jurisdiction: r.jurisdiction, state: r.state, city: r.city, level: r.level,
      category: r.category, key_value: r.key_value, requirement: r.requirement, citation: r.citation, source_doc_id: r.source_doc_id ?? null,
      effective_date: eff.date, date_derived: eff.derived, date_basis: eff.basis, expiry_date: r.expiry_date, review_state: r.review_state,
      in_area_ids: a.yes, maybe_ids: a.maybe,
    });
  }
  const order: Record<ChangeKind, number> = { upcoming: 0, proposed: 1, recent: 2, struck: 3, expired: 4 };
  return items.sort((x, y) => order[x.kind] - order[y.kind] || (x.effective_date ?? "9999").localeCompare(y.effective_date ?? "9999") || x.title.localeCompare(y.title));
}

export type DateDiffItem = {
  rule_id: string; rule_key: string; title: string; jurisdiction: string; category: string; key_value: string | null;
  before: string | null; after: string | null; address_ids: string[];
};

/** Which reported results differ between two dates, grouped by rule and by the before/after pair. */
export function dateDiff(inp: ChangeInput, from: string, to: string): DateDiffItem[] {
  const groups = new Map<string, DateDiffItem>();
  const byKey = new Map(inp.rules.map((r) => [r.rule_key, r]));
  for (const p of inp.properties) {
    const res = inp.resolutions.get(p.id) ?? null;
    const a = new Map(evaluateProperty(p, res, inp.rules, inp.relations, from).map((o) => [o.rule_key, o.result]));
    const b = new Map(evaluateProperty(p, res, inp.rules, inp.relations, to).map((o) => [o.rule_key, o.result]));
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const before = a.get(key) ?? null, after = b.get(key) ?? null;
      if (before === after) continue;
      const rule = byKey.get(key);
      if (!rule) continue;
      const id = `${key}|${before}|${after}`;
      const g = groups.get(id) ?? { rule_id: rule.id, rule_key: key, title: rule.title, jurisdiction: rule.jurisdiction, category: rule.category, key_value: rule.key_value, before, after, address_ids: [] };
      g.address_ids.push(p.address_id);
      groups.set(id, g);
    }
  }
  return Array.from(groups.values()).sort((x, y) => y.address_ids.length - x.address_ids.length || x.title.localeCompare(y.title));
}
