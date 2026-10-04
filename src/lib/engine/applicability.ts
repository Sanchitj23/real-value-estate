import { evaluate, ExprSchema, type Facts, type TraceNode, FACTS } from "./expr";
import { validLegalDate } from "./dates";

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

export function lifecycleOn(rule: Pick<RuleLite, "legal_status" | "effective_date" | "expiry_date" | "enacted_date">, asOf: string): Lifecycle {
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
  if (!rule.effective_date) return "unknown";
  const c = cmpDate(rule.effective_date, asOf);
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

    const scope = (value: unknown, status: string | undefined, confirmed: string, field: string, defaultResult: boolean) => {
      if (value && status === "conditional") {
        const parsed = ExprSchema.safeParse(value);
        if (parsed.success) return evaluate(parsed.data, facts, trace);
      } else if (value == null && status === confirmed) return { result: defaultResult, missing: [] };
      const reason = `manual_review:${field} is not established by validated evidence`;
      trace.push({ label: reason, result: "unknown" });
      return { result: "unknown" as const, missing: [reason] };
    };
    const cov = scope(rule.coverage, rule.coverage_status, "unconditional", "Coverage", true);
    const exm = scope(rule.exemptions, rule.exemptions_status, "none", "Exemptions", false);

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
      if (lifecycle === "future") { result = "not_yet_effective"; parts.push(`Enacted but not effective until ${rule.effective_date}.`); }
      else if (lifecycle === "pending") { result = "pending"; parts.push("Pending proposal — not in force."); }
      else if (lifecycle === "unknown") { result = "unknown"; parts.push("Legal status/effective date could not be established from the extracted evidence."); }
      else result = certain ? "applies" : "unknown";
    }
    missing = Array.from(new Set(missing));
    base.push({
      rule_id: rule.id, rule_key: rule.rule_key, category: rule.category, title: rule.title,
      jurisdiction: rule.jurisdiction, level: rule.level, citation: rule.citation, key_value: rule.key_value,
      review_state: rule.review_state, lifecycle, geo, applicability, result,
      explanation: parts.join(" ") + (missing.length ? ` Missing: ${missing.map(factLabel).join("; ")}.` : ""),
      missing, conflict_flag: false, conflict_note: null, trace,
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
