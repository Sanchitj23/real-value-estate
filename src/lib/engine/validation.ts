import { z } from "zod";
import { CATEGORIES } from "./applicability";
import { ExprSchema } from "./expr";
import { LegalDate } from "./dates";
import { findQuote } from "./quote";

export const PatchSchema = z.object({
  legal_status: z.enum(["enacted", "pending", "failed", "repealed", "unknown"]).optional(),
  effective_date: LegalDate.nullable().optional(),
  requirement: z.string().min(1).max(4000).optional(),
  key_value: z.string().max(1000).nullable().optional(),
  coverage: ExprSchema.nullable().optional(), exemptions: ExprSchema.nullable().optional(),
  coverage_status: z.enum(["conditional", "unconditional", "unknown"]).optional(),
  exemptions_status: z.enum(["conditional", "none", "unknown"]).optional(),
}).strict();

export type EvidenceQuote = { field: string; quote: string };
export function anchorEvidence(text: string, quotes: EvidenceQuote[]) {
  return quotes.map((e) => {
    const m = findQuote(text, e.quote);
    return { field: e.field, quote: m ? text.slice(m.start, m.end) : e.quote,
      start_offset: m?.start ?? null, end_offset: m?.end ?? null,
      match_kind: m?.kind ?? "not_found", valid: !!m };
  });
}

/** Quote matching proves provenance, not that the model interpreted the law correctly. */
export function validateCandidate(c: Record<string, unknown>, text: string) {
  const errors: string[] = [];
  const supporting = z.array(z.object({ field: z.string(), quote: z.string() })).max(30).safeParse(c["supporting_quotes"]);
  if (!supporting.success) errors.push("Invalid supporting_quotes");
  const evidence = anchorEvidence(text, [{ field: "quoted_span", quote: String(c["quoted_span"] ?? "") }, ...(supporting.success ? supporting.data : [])]);
  if (String(c["quoted_span"] ?? "").length < 20 || !evidence[0]?.valid) errors.push("Requirement quote not found in source");
  for (const e of evidence) if (!e.valid) errors.push(`${e.field}: quote not found in source`);
  const supported = (field: string) => evidence.some((e) => e.field === field && e.valid);
  if (!CATEGORIES.includes(c["category"] as never)) errors.push("Invalid category");
  if (!String(c["title"] ?? "").trim() || !String(c["requirement"] ?? "").trim()) errors.push("Missing title or requirement");
  const dates: Record<string, string | null> = {};
  for (const field of ["enacted_date", "effective_date", "expiry_date"]) {
    dates[field] = null;
    if (c[field] != null) {
      const parsed = LegalDate.safeParse(c[field]);
      if (!parsed.success || !supported(field)) errors.push(`${field}: valid date and field-specific quote required`);
      else dates[field] = parsed.data;
    }
  }
  let legal_status = String(c["legal_status"] ?? "unknown");
  if (!["enacted", "pending", "failed", "repealed", "unknown"].includes(legal_status)) { errors.push("Invalid legal_status"); legal_status = "unknown"; }
  if (legal_status !== "unknown" && !supported("legal_status")) { errors.push("Legal status lacks evidence"); legal_status = "unknown"; }
  const parseScope = (field: "coverage" | "exemptions", absent: string) => {
    const raw = c[`${field}_expr_json`];
    const claimed = String(c[`${field}_status`] ?? "unknown");
    if (raw != null && raw !== "null" && raw !== "") {
      try {
        const parsed = ExprSchema.safeParse(JSON.parse(String(raw)));
        if (parsed.success && supported(field)) return { expr: parsed.data, status: "conditional" };
      } catch { /* Validation result remains unknown. */ }
      errors.push(`${field}: validated expression and field-specific quote required`);
    } else if (claimed === absent && supported(field)) return { expr: null, status: absent };
    else if (claimed !== "unknown") errors.push(`${field}: absence of conditions is not evidence of unrestricted scope`);
    return { expr: null, status: "unknown" };
  };
  const coverage = parseScope("coverage", "unconditional"), exemptions = parseScope("exemptions", "none");
  if (c["key_value"] != null && !supported("key_value")) errors.push("key_value lacks field-specific evidence");
  return { errors, evidence, dates, legal_status, coverage: coverage.expr, exemptions: exemptions.expr,
    coverage_status: coverage.status, exemptions_status: exemptions.status, valid: errors.length === 0 };
}
