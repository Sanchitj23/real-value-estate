import { z } from "zod";

/**
 * Whitelisted, validated condition language. Three-valued evaluation:
 * true | false | "unknown". No dynamic code, no arbitrary expressions.
 */

export const FACTS = {
  "property.units": { type: "number", label: "Building unit count", question: "How many residential units are in the building?" },
  "property.year_built": { type: "number", label: "Year built (assessor)", question: "Year built per assessor record. Note: not a certificate-of-occupancy date." },
  "property.use_code": { type: "string", label: "Assessor use code", question: "Assessor land-use code." },
  "property.is_residential": { type: "boolean", label: "Residential use", question: "Is the property used for residential rental housing?" },
  "property.certificate_of_occupancy_year": { type: "number", label: "Certificate-of-occupancy year", question: "When was the first certificate of occupancy issued?" },
  "property.single_family_or_condo": { type: "boolean", label: "Single-family home or condo", question: "Is the unit a separately alienable single-family home or condominium?" },
  "unit.is_subsidized": { type: "boolean", label: "Government-subsidized unit", question: "Is the unit subsidized or deed-restricted affordable housing?" },
  "tenancy.months_occupied": { type: "number", label: "Months of tenancy", question: "How long has the tenant occupied the unit?" },
  "tenancy.is_shared_with_owner": { type: "boolean", label: "Shared with owner", question: "Does the tenant share kitchen or bath with the owner?" },
  "ownership.owner_occupied": { type: "boolean", label: "Owner-occupied", question: "Does the owner live on the property?" },
  "ownership.is_corporate": { type: "boolean", label: "Corporate / REIT owner", question: "Is the owner a corporation, REIT or LLC with corporate member?" },
  "ownership.portfolio_units": { type: "number", label: "Owner portfolio units", question: "How many units does the owner hold in total? (Not the building count.)" },
  "program.exemption_filed": { type: "boolean", label: "Exemption filed", question: "Has the owner filed a required exemption notice?" },
  "conduct.uses_pricing_algorithm": { type: "boolean", label: "Uses pricing algorithm", question: "Does the landlord use algorithmic rent-setting software?" },
  "jurisdiction.city": { type: "string", label: "Legal city", question: "Which incorporated municipality is the address in?" },
} as const;
export type FactKey = keyof typeof FACTS;
export const FACT_KEYS = Object.keys(FACTS) as FactKey[];

export type Expr =
  | { operator: "all" | "any"; children: Expr[] }
  | { operator: "not"; children: [Expr] }
  | { operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; fact: string; value: string | number | boolean }
  | { operator: "in"; fact: string; value: (string | number)[] }
  | { operator: "manual_review"; reason: string };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ operator: z.enum(["all", "any"]), children: z.array(ExprSchema).min(1) }),
    z.object({ operator: z.literal("not"), children: z.tuple([ExprSchema]) }),
    z.object({
      operator: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
      fact: z.enum(FACT_KEYS as [string, ...string[]]),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({
      operator: z.literal("in"),
      fact: z.enum(FACT_KEYS as [string, ...string[]]),
      value: z.array(z.union([z.string(), z.number()])),
    }),
    z.object({ operator: z.literal("manual_review"), reason: z.string().min(3) }),
  ]),
) as z.ZodType<Expr>;

export type Tri = true | false | "unknown";
export type Facts = Partial<Record<string, string | number | boolean | null>>;
export type TraceNode = { label: string; result: Tri; missing?: string[] };

export function describe(e: Expr): string {
  switch (e.operator) {
    case "all": return e.children.map(describe).join(" AND ");
    case "any": return "(" + e.children.map(describe).join(" OR ") + ")";
    case "not": return "NOT " + describe(e.children[0]);
    case "manual_review": return `manual review: ${e.reason}`;
    case "in": return `${e.fact} in [${e.value.join(", ")}]`;
    default: return `${e.fact} ${e.operator} ${String(e.value)}`;
  }
}

/** Evaluate with Kleene three-valued logic. Collects missing facts only on paths that matter. */
export function evaluate(e: Expr, facts: Facts, trace: TraceNode[] = []): { result: Tri; missing: string[] } {
  switch (e.operator) {
    case "all": {
      const parts = e.children.map((c) => evaluate(c, facts, trace));
      if (parts.some((p) => p.result === false)) return { result: false, missing: [] };
      if (parts.every((p) => p.result === true)) return { result: true, missing: [] };
      return { result: "unknown", missing: uniq(parts.flatMap((p) => p.missing)) };
    }
    case "any": {
      const parts = e.children.map((c) => evaluate(c, facts, trace));
      if (parts.some((p) => p.result === true)) return { result: true, missing: [] };
      if (parts.every((p) => p.result === false)) return { result: false, missing: [] };
      return { result: "unknown", missing: uniq(parts.flatMap((p) => p.missing)) };
    }
    case "not": {
      const r = evaluate(e.children[0], facts, trace);
      return { result: r.result === "unknown" ? "unknown" : !r.result, missing: r.missing };
    }
    case "manual_review":
      trace.push({ label: describe(e), result: "unknown" });
      return { result: "unknown", missing: [`manual_review:${e.reason}`] };
    default: {
      const v = facts[e.fact];
      if (v === undefined || v === null) {
        trace.push({ label: describe(e), result: "unknown", missing: [e.fact] });
        return { result: "unknown", missing: [e.fact] };
      }
      let r: Tri = "unknown";
      if (e.operator === "in") {
        r = (e.value as (string | number)[]).some((x) => norm(x) === norm(v));
      } else if (e.operator === "eq" || e.operator === "neq") {
        if (typeof v !== typeof e.value && !(typeof v === "string" || typeof e.value === "string")) r = "unknown";
        else { const eq = norm(v) === norm(e.value); r = e.operator === "eq" ? eq : !eq; }
      } else {
        if (typeof v !== "number" || typeof e.value !== "number") r = "unknown";
        else r = e.operator === "lt" ? v < e.value : e.operator === "lte" ? v <= e.value : e.operator === "gt" ? v > e.value : v >= e.value;
      }
      trace.push({ label: describe(e), result: r });
      return { result: r, missing: r === "unknown" ? [e.fact] : [] };
    }
  }
}

function norm(x: unknown) { return typeof x === "string" ? x.trim().toLowerCase() : x; }
function uniq<T>(a: T[]) { return Array.from(new Set(a)); }
