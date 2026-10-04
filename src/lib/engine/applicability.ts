import { evaluate, ExprSchema, type Facts, type TraceNode, FACTS } from "./expr";
import { deriveEffectiveDate, validLegalDate } from "./dates";

export const DEFAULT_AS_OF = "2026-10-01";
export const DISCLAIMER = "Not legal advice. Prototype using supplied public sources.";

export const CATEGORIES = [
  "rent_increase_limits",
  "just_cause_eviction",
  "security_deposits",
  "application_screening_fees",
  "screening_restrictions",
  "algorithmic_rent_setting",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<string, string> = {
  rent_increase_limits: "Rent increase limits",
  just_cause_eviction: "Just-cause eviction",
  security_deposits: "Security deposits",
  application_screening_fees: "Application & screening fees",
  screening_restrictions: "Screening restrictions",
  algorithmic_rent_setting: "Algorithmic rent setting",
};

export type RuleLite = {
  id: string;
  rule_key: string;
  version: number;
  state: string;
  level: string;
  city: string | null;
  jurisdiction: string;
  category: string;
  title: string;
  requirement: string;
  key_value: string | null;
  citation: string;
  source_url: string | null;
  source_doc_id?: string | null;
  legal_status: string;
  enacted_date?: string | null;
  effective_date: string | null;
  /** Verbatim effective-date clause from the source, when the date itself could not be read as a calendar date. */
  effective_clause?: string | null;
  expiry_date: string | null;
  coverage: unknown;
  exemptions: unknown;
  coverage_status?: string;
  exemptions_status?: string;
  coverage_text?: string | null;
  exemptions_text?: string | null;
  penalty?: string | null;
  retrieved_at?: string | null;
  review_state: string;
  quoted_span: string;
  confidence: number | null;
};

export type PropertyLite = {
  id: string;
  address_id: string;
  street_address: string;
  postal_city: string | null;
  state: string;
  zip: string | null;
  year_built: number | null;
  units: number | null;
  use_code: string | null;
  use_description: string | null;
};

export type ResolutionLite = {
  status: string;
  place_name: string | null;
  place_kind: string | null;
  county_name: string | null;
  lat: number | null;
  lon: number | null;
} | null;

export type RelationLite = { from_rule_key: string; to_rule_key: string; relation_type: string; note: string | null; effective_from?: string | null; effective_to?: string | null };

export type Lifecycle = "in_force" | "future" | "pending" | "failed" | "repealed" | "unknown";
export type Applicability = "true" | "false" | "unknown" | "exempt" | "superseded";
export type ExportResult = "applies" | "unknown" | "superseded" | "not_yet_effective" | "pending";

export type RuleOutcome = {
  rule_id: string;
  rule_key: string;
  category: string;
  title: string;
  jurisdiction: string;
  level: string;
  citation: string;
  key_value: string | null;
  review_state: string;
  lifecycle: Lifecycle;
  geo: "true" | "false" | "unknown";
  applicability: Applicability;
  result: ExportResult | null; // null = not reported (not applicable / failed / out of area)
  explanation: string;
  missing: string[];
  conflict_flag: boolean;
  conflict_note: string | null;
  /** Plain statements the answer rests on, e.g. that the source text states no exemption. */
  assumptions: string[];
  trace: TraceNode[];
};

/** Compare possibly partial ISO dates (YYYY, YYYY-MM, YYYY-MM-DD). Returns null if precision prevents a decision. */
export function cmpDate(a: string, b: string): -1 | 0 | 1 | null {
  if (!validLegalDate(a) || !validLegalDate(b)) return null;
  const pa = a.split("-"), pb = b.split("-");
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? "", y = pb[i] ?? "";
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return pa.length === pb.length ? 0 : null;
}

type Dated = Pick<RuleLite, "legal_status" | "effective_date" | "expiry_date" | "enacted_date" | "effective_clause"> & Partial<Pick<RuleLite, "state" | "level">>;
export type DateBasis = "stated" | "clause" | "state_default" | null;
export const DATE_BASIS_NOTE: Record<Exclude<DateBasis, null | "stated">, string> = {
  clause: "date worked out from the law's own effective-date clause",
  state_default: "the text gives no date, so California's general rule is used: a statute takes effect on 1 January after it is enacted",
};

/**
 * The stated effective date, or one derived from (a) a quoted relative clause plus the enactment date, or (b) for a
 * California state statute with an enactment date and no clause, the state's general rule (Cal. Const. art. IV, s. 8(c)):
 * 1 January following enactment. Derived dates are always labelled.
 */
export function effectiveDateOf(rule: Pick<RuleLite, "effective_date" | "enacted_date" | "effective_clause"> & Partial<Pick<RuleLite, "state" | "level">>): { date: string | null; derived: boolean; basis: DateBasis } {
  if (rule.effective_date) return { date: rule.effective_date, derived: false, basis: "stated" };
  if (rule.effective_clause) {
    const date = deriveEffectiveDate(rule.effective_clause, rule.enacted_date);
    return { date, derived: !!date, basis: date ? "clause" : null };
  }
  if (rule.state === "CA" && rule.level === "state" && rule.enacted_date?.length === 10 && validLegalDate(rule.enacted_date)) {
    return { date: `${Number(rule.enacted_date.slice(0, 4)) + 1}-01-01`, derived: true, basis: "state_default" };
  }
  return { date: null, derived: false, basis: null };
}

export function lifecycleOn(rule: Dated, asOf: string): Lifecycle {
  if (!validLegalDate(asOf)) return "unknown";
  const s = rule.legal_status;
  if (s === "failed") return "failed";
  if (s === "pending") return "pending";
  if (rule.enacted_date) {
    const enacted = cmpDate(rule.enacted_date, asOf);
    if (enacted === null || enacted > 0) return "unknown";
  }
  if (rule.expiry_date) {
    const c = cmpDate(rule.expiry_date, asOf);
    if (c === null) return "unknown";
    if (c !== null && c <= 0) return "repealed";
  }
  if (s === "repealed") return "repealed";
  if (s !== "enacted") return "unknown";
  const effective = effectiveDateOf(rule).date;
  // Codified law whose source states no enactment or effective date is treated as in force (as the organiser's sample
  // record does). A law with an enactment date or an unresolved effective-date clause stays unknown.
  if (!effective) return !rule.enacted_date && !rule.effective_clause ? "in_force" : "unknown";
  const c = cmpDate(effective, asOf);
  if (c === null) return "unknown";
  return c > 0 ? "future" : "in_force";
}

export function normCity(s: string | null | undefined) {
  return (s ?? "").toLowerCase().replace(/\b(city|town|township)\b/g, "").replace(/[^a-z]/g, "");
}

const RESIDENTIAL_RE = /(apartment|residential|dwelling|family|condo|duplex|triplex|fourplex|multi|res\b)/i;

/** Facts derived only from supplied records. Everything else is unknown. */
export function factsFor(p: PropertyLite, r: ResolutionLite): Facts {
  return {
    "property.units": p.units,
    "property.year_built": p.year_built,
    "property.use_code": p.use_code,
    "property.is_residential": p.use_description && RESIDENTIAL_RE.test(p.use_description) ? true : null,
    "jurisdiction.city": r && r.status === "resolved" && r.place_kind === "incorporated" ? r.place_name : null,
  };
}

function geoFor(rule: RuleLite, p: PropertyLite, r: ResolutionLite): "true" | "false" | "unknown" {
  if (rule.state !== p.state) return "false";
  if (rule.level === "state") return "true";
  if (!r || r.status !== "resolved") return "unknown";
  if (r.place_kind !== "incorporated" || !r.place_name) return "false";
  return normCity(r.place_name) === normCity(rule.city) ? "true" : "false";
}

const factLabel = (k: string) =>
  k.startsWith("manual_review:") ? `Manual review — ${k.slice(14)}` : (FACTS as Record<string, { label: string }>)[k]?.label ?? k;

export function evaluateProperty(
  p: PropertyLite,
  res: ResolutionLite,
  rules: RuleLite[],
  relations: RelationLite[],
  asOf: string,
): RuleOutcome[] {
  const facts = factsFor(p, res);
  const base: RuleOutcome[] = [];
  for (const rule of rules) {
    if (rule.review_state === "invalid") continue;
    const geo = geoFor(rule, p, res);
    if (geo === "false") continue;
    const lifecycle = lifecycleOn(rule, asOf);
    const trace: TraceNode[] = [];
    let applicability: Applicability = "unknown";
    let result: ExportResult | null = null;
    let missing: string[] = [];
    const parts: string[] = [];
    const where = rule.level === "state" ? `Statewide ${rule.state} rule` : `${rule.jurisdiction} local rule`;

    if (geo === "unknown") {
      parts.push(`${where}; the legal city for this address is not yet resolved (postal city "${p.postal_city ?? "—"}" is not proof of jurisdiction).`);
      missing.push("jurisdiction.city");
    } else parts.push(`${where}; the address is within its jurisdiction.`);

    const assumptions: string[] = [];
    const scope = (value: unknown, status: string | undefined, text: string | null | undefined, confirmed: string, field: string, defaultResult: boolean, silent: string) => {
      if (value && status === "conditional") {
        const parsed = ExprSchema.safeParse(value);
        if (parsed.success) return evaluate(parsed.data, facts, trace);
      } else if (value == null && status === confirmed) return { result: defaultResult, missing: [] };
      else if (value == null && (status ?? "unknown") === "unknown" && !text?.trim()) {
        // The reader found no wording on this point at all. The answer then does not depend on a missing fact, so it
        // is given, with the assumption stated. Wording that exists but could not be checked stays unknown below.
        assumptions.push(silent);
        trace.push({ label: silent, result: defaultResult });
        return { result: defaultResult, missing: [] };
      }
      const reason = `manual_review:${field} is not established by validated evidence`;
      trace.push({ label: reason, result: "unknown" });
      return { result: "unknown" as const, missing: [reason] };
    };
    const cov = scope(rule.coverage, rule.coverage_status, rule.coverage_text, "unconditional", "Coverage", true, "The source text read for this rule states no property condition");
    const exm = scope(rule.exemptions, rule.exemptions_status, rule.exemptions_text, "none", "Exemptions", false, "The source text read for this rule states no exemption");

    if (lifecycle === "failed" || lifecycle === "repealed") {
      applicability = "false";
      parts.push(lifecycle === "failed" ? "Measure failed / was struck; it is not a current protection." : "Provision expired or repealed as of the query date.");
    } else if (cov.result === false) {
      applicability = "false";
      parts.push("Coverage conditions are not met by the recorded building facts.");
    } else if (cov.result === true && exm.result === true) {
      applicability = "exempt";
      parts.push("An exemption is met by recorded facts.");
    } else {
      if (cov.result === "unknown") { missing.push(...cov.missing); parts.push("Coverage depends on facts not in the supplied data."); }
      if (exm.result === "unknown") { missing.push(...exm.missing); parts.push("An exemption may apply depending on facts not in the supplied data."); }
      const certain = geo === "true" && cov.result === true && exm.result === false;
      applicability = certain ? "true" : "unknown";
      if (lifecycle === "future") { const eff = effectiveDateOf(rule); result = "not_yet_effective"; parts.push(`Enacted but not effective until ${eff.date}${eff.basis === "clause" || eff.basis === "state_default" ? ` (${DATE_BASIS_NOTE[eff.basis]})` : ""}.`); }
      else if (lifecycle === "pending") { result = "pending"; parts.push("Pending proposal — not in force."); }
      else if (lifecycle === "unknown") { result = "unknown"; parts.push("Legal status/effective date could not be established from the extracted evidence."); }
      else result = certain ? "applies" : "unknown";
    }
    missing = Array.from(new Set(missing));
    base.push({
      rule_id: rule.id, rule_key: rule.rule_key, category: rule.category, title: rule.title,
      jurisdiction: rule.jurisdiction, level: rule.level, citation: rule.citation, key_value: rule.key_value,
      review_state: rule.review_state, lifecycle, geo, applicability, result,
      explanation: parts.join(" ") + (result && assumptions.length ? ` ${assumptions.join(". ")}.` : "") + (missing.length ? ` Missing: ${missing.map(factLabel).join("; ")}.` : ""),
      missing, conflict_flag: false, conflict_note: null, assumptions: result ? assumptions : [], trace,
    });
  }

  // Documented interactions only.
  const byKey = new Map(base.map((o) => [o.rule_key, o]));
  for (const rel of relations) {
    if (rel.effective_from && cmpDate(rel.effective_from, asOf) !== -1 && cmpDate(rel.effective_from, asOf) !== 0) continue;
    if (rel.effective_to && cmpDate(rel.effective_to, asOf) !== 1) continue;
    const a = byKey.get(rel.from_rule_key), b = byKey.get(rel.to_rule_key);
    if (!a || !b) continue;
    if ((rel.relation_type === "replaces" || rel.relation_type === "stricter-local-standard") && a.category === b.category) {
      if (a.result === "applies" && b.result === "applies") {
        b.applicability = "superseded"; b.result = "superseded";
        b.explanation += ` Superseded by ${a.title} (${rel.relation_type}).`;
      } else if (a.result && b.result === "applies" && a.result !== "not_yet_effective" && a.result !== "pending") {
        b.applicability = "unknown"; b.result = "unknown"; b.conflict_flag = true;
        b.conflict_note = `Which standard governs depends on unresolved coverage of ${a.title}.`;
        b.explanation += ` May be superseded by ${a.title} if its coverage is established.`;
      }
    }
    if (rel.relation_type === "possible-preemption" || rel.relation_type === "unresolved-conflict") {
      if (!a.result || !b.result) continue;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        x.conflict_flag = true;
        x.conflict_note = `${rel.relation_type} with ${y.title}${rel.note ? ` — ${rel.note}` : ""}. Human review required.`;
      }
    }
  }
  return base;
}

export const factLabelOf = factLabel;
