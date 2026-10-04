import type { RuleLite, ExportResult } from "./applicability";
import type { Expr } from "./expr";

export type Patch = { [K in "legal_status" | "effective_date" | "requirement" | "key_value" | "coverage_status" | "exemptions_status"]?: RuleLite[K] | undefined } & { coverage?: Expr | null | undefined; exemptions?: Expr | null | undefined };
export type DiffLabel = "added" | "removed" | "changed" | "newly_uncertain" | "resolved_uncertainty" | "no_change";

export function materialRule(rule: RuleLite | undefined) {
  if (!rule) return null;
  return { requirement: rule.requirement, key_value: rule.key_value, coverage: rule.coverage, exemptions: rule.exemptions, coverage_status: rule.coverage_status ?? "unknown", exemptions_status: rule.exemptions_status ?? "unknown", legal_status: rule.legal_status, effective_date: rule.effective_date, expiry_date: rule.expiry_date, penalty: rule.penalty ?? null };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function canonicalJson(value: unknown): string {
  return canonical(JSON.parse(JSON.stringify(value) ?? "null"));
}
export function diffLabel(a: ExportResult | null, b: ExportResult | null, before?: RuleLite, after?: RuleLite): DiffLabel {
  if (a === b) return a && canonicalJson(materialRule(before)) !== canonicalJson(materialRule(after)) ? "changed" : "no_change";
  if (!a && b === "applies") return "added";
  if (a && !b) return "removed";
  if (b === "unknown") return "newly_uncertain";
  if (a === "unknown") return "resolved_uncertainty";
  return "changed";
}
