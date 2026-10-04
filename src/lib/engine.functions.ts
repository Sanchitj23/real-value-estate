import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadEngineInputs, publicClient, type EngineInputs } from "./data.server";
import {
  CATEGORIES, DEFAULT_AS_OF, evaluateProperty,
  type ExportResult, type RuleLite, type RuleOutcome, lifecycleOn,
} from "./engine/applicability";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RANK: Record<string, number> = { applies: 5, unknown: 4, not_yet_effective: 3, pending: 2, superseded: 1 };

type Patch = { legal_status?: string; effective_date?: string | null };

function applyPatch(rules: RuleLite[], ruleKey: string, patch: Patch): RuleLite[] {
  return rules.map((r) => (r.rule_key === ruleKey ? { ...r, ...patch } : r));
}

function evalAll(inp: EngineInputs, asOf: string, rules = inp.rules) {
  return inp.properties.map((p) => ({
    property: p,
    resolution: inp.resolutions.get(p.id) ?? null,
    outcomes: evaluateProperty(p, inp.resolutions.get(p.id) ?? null, rules, inp.relations, asOf),
  }));
}

function summarize(outcomes: RuleOutcome[]) {
  const cats: Record<string, ExportResult | null> = {};
  for (const c of CATEGORIES) {
    const best = outcomes.filter((o) => o.category === c && o.result).sort((a, b) => RANK[b.result!] - RANK[a.result!])[0];
    cats[c] = best?.result ?? null;
  }
  return {
    categories: cats,
    unknown_count: outcomes.filter((o) => o.result === "unknown").length,
    conflict: outcomes.some((o) => o.conflict_flag),
  };
}

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data: ds } = await sb.from("dataset_versions").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ds) return { dataset: null, counts: null };
  const [p, s, st, r, rv, ri, jr, jres] = await Promise.all([
    sb.from("properties").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id),
    sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id),
    sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id).eq("text_available", true),
    sb.from("rule_versions").select("id", { count: "exact", head: true }).eq("is_current", true),
    sb.from("rule_versions").select("id", { count: "exact", head: true }).eq("is_current", true).eq("review_state", "reviewed"),
    sb.from("rule_versions").select("id", { count: "exact", head: true }).eq("is_current", true).eq("review_state", "invalid"),
    sb.from("jurisdiction_resolutions").select("id", { count: "exact", head: true }).eq("is_current", true),
    sb.from("jurisdiction_resolutions").select("id", { count: "exact", head: true }).eq("is_current", true).eq("status", "resolved"),
  ]);
  return {
    dataset: { id: ds.id, created_at: ds.created_at, upload_sha256: ds.upload_sha256, known_gaps: ds.known_gaps, receipt: ds.receipt, package_metadata: ds.package_metadata },
    counts: {
      properties: p.count ?? 0, sources: s.count ?? 0, captured: st.count ?? 0,
      rules: r.count ?? 0, reviewed: rv.count ?? 0, invalid: ri.count ?? 0,
      geocoded: jr.count ?? 0, resolved: jres.count ?? 0,
    },
  };
});

export const getPropertyReport = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ addressId: z.string(), asOf: DateStr.default(DEFAULT_AS_OF) }).parse(d))
  .handler(async ({ data }) => {
    const inp = await loadEngineInputs();
    const p = inp.properties.find((x) => x.address_id === data.addressId);
    if (!p) return null;
    const res = inp.resolutions.get(p.id) ?? null;
    const outcomes = evaluateProperty(p, res, inp.rules, inp.relations, data.asOf);
    const ruleMap = new Map(inp.rules.map((r) => [r.id, r]));
    const notCurrent = inp.rules
      .filter((r) => r.state === p.state && ["failed", "repealed"].includes(lifecycleOn(r, data.asOf)))
      .map((r) => ({ title: r.title, jurisdiction: r.jurisdiction, lifecycle: lifecycleOn(r, data.asOf), citation: r.citation }));
    return {
      asOf: data.asOf,
      property: p,
      resolution: res,
      outcomes: outcomes.map((o) => ({
        ...o,
        quoted_span: ruleMap.get(o.rule_id)?.quoted_span ?? "",
        source_doc_id: ruleMap.get(o.rule_id)?.source_doc_id ?? null,
        requirement: ruleMap.get(o.rule_id)?.requirement ?? "",
        source_url: ruleMap.get(o.rule_id)?.source_url ?? null,
      })),
      summary: summarize(outcomes),
      notCurrent,
      ruleCount: inp.rules.length,
    };
  });

export const getPortfolio = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ asOf: DateStr.default(DEFAULT_AS_OF) }).parse(d))
  .handler(async ({ data }) => {
    const inp = await loadEngineInputs();
    const rows = evalAll(inp, data.asOf).map(({ property, resolution, outcomes }) => ({
      property,
      resolution: resolution ? { status: resolution.status, place_name: resolution.place_name, place_kind: resolution.place_kind, lat: resolution.lat, lon: resolution.lon } : null,
      ...summarize(outcomes),
    }));
    return { asOf: data.asOf, rows, ruleCount: inp.rules.length };
  });

type DiffLabel = "added" | "removed" | "changed" | "newly_uncertain" | "resolved_uncertainty" | "no_change";
function diffLabel(a: ExportResult | null, b: ExportResult | null): DiffLabel {
  if (a === b) return "no_change";
  if (!a && b === "applies") return "added";
  if (a && !b) return "removed";
  if (b === "unknown") return "newly_uncertain";
  if (a === "unknown") return "resolved_uncertainty";
  if (!a && b) return b === "applies" ? "added" : "changed";
  return "changed";
}

function compareRule(inp: EngineInputs, ruleKey: string, asA: string, rulesA: RuleLite[], asB: string, rulesB: RuleLite[]) {
  const A = evalAll(inp, asA, rulesA), B = evalAll(inp, asB, rulesB);
  return A.map((x, i) => {
    const a = x.outcomes.find((o) => o.rule_key === ruleKey) ?? null;
    const b = B[i].outcomes.find((o) => o.rule_key === ruleKey) ?? null;
    return {
      address_id: x.property.address_id, street: x.property.street_address, postal_city: x.property.postal_city, state: x.property.state,
      units: x.property.units,
      before: a?.result ?? null, after: b?.result ?? null,
      conflict_after: b?.conflict_flag ?? false,
      label: diffLabel(a?.result ?? null, b?.result ?? null),
    };
  });
}

function bucket(rows: ReturnType<typeof compareRule>) {
  const changed = rows.filter((r) => r.label !== "no_change");
  return {
    definitely_changed: changed.filter((r) => r.after === "applies" || r.before === "applies").length,
    potentially_affected: changed.filter((r) => r.after === "unknown" || r.before === "unknown").length,
    unchanged: rows.length - changed.length,
    known_units_changed: changed.reduce((s, r) => s + (r.units ?? 0), 0),
    unknown_units_properties: changed.filter((r) => r.units == null).length,
  };
}

async function runTests(inp: EngineInputs) {
  const sb = publicClient();
  const { data: maps } = await sb.from("semantic_mappings").select("*");
  const mapping = new Map((maps ?? []).map((m) => [m.challenge_rule_id, m.rule_key]));
  const tests = (inp.dataset?.change_tests ?? []) as Array<Record<string, unknown>>;
  return tests.map((t) => {
    const ids = (t.rule_ids as string[]) ?? [];
    const unmapped = ids.filter((id) => !mapping.get(id) || !inp.rules.some((r) => r.rule_key === mapping.get(id)));
    const base = { test_id: t.test_id as string, title: t.title as string, type: t.type as string, expected: t.expected_behavior as string, rule_ids: ids, mapping: Object.fromEntries(ids.map((i) => [i, mapping.get(i) ?? null])) };
    if (unmapped.length === ids.length) return { ...base, status: "incomplete" as const, note: `No extracted rule mapped for ${unmapped.join(", ")}. Map a challenge ID to an extracted rule in the reviewer workspace.`, per_rule: [] as Array<{ challenge_id: string; rule_key: string; rows: ReturnType<typeof compareRule>; summary: ReturnType<typeof bucket> }>, affected: [] as string[], conflicts: [] as string[] };
    const per_rule = ids.filter((i) => !unmapped.includes(i)).map((cid) => {
      const key = mapping.get(cid)!;
      let rows: ReturnType<typeof compareRule>;
      if (t.type === "as_of") rows = compareRule(inp, key, t.as_of_before as string, inp.rules, t.as_of_after as string, inp.rules);
      else if (t.type === "pending") rows = compareRule(inp, key, t.as_of as string, inp.rules, t.as_of as string, applyPatch(inp.rules, key, { legal_status: "enacted", effective_date: null }));
      else rows = compareRule(inp, key, t.as_of as string, inp.rules, t.as_of as string, inp.rules);
      return { challenge_id: cid, rule_key: key, rows, summary: bucket(rows) };
    });
    let affected: string[] = [];
    if (t.type === "boundary" || t.type === "negative") affected = per_rule.flatMap((r) => r.rows.filter((x) => x.after === "applies" || x.after === "unknown").map((x) => x.address_id));
    else affected = per_rule.flatMap((r) => r.rows.filter((x) => x.label !== "no_change").map((x) => x.address_id));
    const conflicts = per_rule.flatMap((r) => r.rows.filter((x) => x.conflict_after).map((x) => x.address_id));
    return {
      ...base,
      status: unmapped.length ? ("partial" as const) : ("evaluated" as const),
      note: unmapped.length ? `Unmapped: ${unmapped.join(", ")}` : t.type === "pending" ? "After = separately labeled hypothetical enactment; current status remains pending." : "",
      per_rule, affected: Array.from(new Set(affected)).sort(), conflicts: Array.from(new Set(conflicts)).sort(),
    };
  });
}

export const runChangeTests = createServerFn({ method: "GET" }).handler(async () => {
  const inp = await loadEngineInputs();
  const results = await runTests(inp);
  return results.map((r) => ({ ...r, per_rule: r.per_rule.map((p) => ({ ...p, rows: p.rows.filter((x) => x.label !== "no_change" || x.after) })) }));
});

export const runScenario = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ scenarioId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: sc } = await sb.from("scenarios").select("*").eq("id", data.scenarioId).single();
    if (!sc) throw new Error("Scenario not found");
    const inp = await loadEngineInputs();
    const patched = applyPatch(inp.rules, sc.rule_key, sc.patch as Patch);
    const rows = compareRule(inp, sc.rule_key, sc.as_of, inp.rules, sc.as_of, patched);
    return { scenario: sc, rows: rows.filter((r) => r.label !== "no_change" || r.after), summary: bucket(rows), sample_size: rows.length };
  });

export const exportSubmission = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ kind: z.enum(["rules", "lookups", "changes"]) }).parse(d))
  .handler(async ({ data }) => {
    const inp = await loadEngineInputs();
    if (data.kind === "rules") {
      return {
        rules: inp.rules.filter((r) => r.review_state !== "invalid").map((r) => {
          const lc = lifecycleOn(r, DEFAULT_AS_OF);
          const rels = inp.relations.filter((x) => x.from_rule_key === r.rule_key || x.to_rule_key === r.rule_key);
          return {
            team_rule_id: r.rule_key, jurisdiction: r.jurisdiction, level: r.level, category: r.category,
            status: lc === "future" ? "not_yet_effective" : lc === "pending" ? "pending" : lc === "failed" || lc === "repealed" ? "failed" : "in_force",
            title: r.title, requirement: r.requirement, key_value: r.key_value,
            coverage_conditions: r.coverage ?? null, exemptions: r.exemptions ? JSON.stringify(r.exemptions) : null,
            overrides: rels.map((x) => (x.from_rule_key === r.rule_key ? x.to_rule_key : x.from_rule_key)),
            interaction: rels.map((x) => `${x.from_rule_key} ${x.relation_type} ${x.to_rule_key}`).join("; ") || null,
            effective_date: r.effective_date, citation: r.citation, source_doc_id: r.source_doc_id ?? null,
            source_url: r.source_url ?? "", quoted_span: r.quoted_span, confidence: r.confidence,
            conflict_flag: rels.some((x) => x.relation_type === "possible-preemption" || x.relation_type === "unresolved-conflict"),
            conflict_note: null,
          };
        }),
      };
    }
    if (data.kind === "lookups") {
      const lookups: Record<string, unknown[]> = {};
      for (const x of evalAll(inp, DEFAULT_AS_OF)) {
        lookups[x.property.address_id] = x.outcomes.filter((o) => o.result).map((o) => ({ team_rule_id: o.rule_key, result: o.result, explanation: o.explanation, conflict_flag: o.conflict_flag }));
      }
      return { as_of: DEFAULT_AS_OF, lookups };
    }
    const tests = await runTests(inp);
    const out: Record<string, unknown> = {};
    for (const t of tests) out[t.test_id] = { affected_address_ids: t.affected, conflict_flag_address_ids: t.conflicts, notes: `${t.status}. ${t.note}`.trim() };
    return out;
  });
