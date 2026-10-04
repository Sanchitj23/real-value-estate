import { readAll } from "./db-result";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadEngineInputs, publicClient, type EngineInputs, assertDb } from "./data.server";
import {
  CATEGORIES, DEFAULT_AS_OF, evaluateProperty,
  type ExportResult, type RuleLite, type RuleOutcome, lifecycleOn, normCity,
} from "./engine/applicability";

import { QueryDate } from "./engine/dates";
import { canonicalJson, diffLabel, type Patch } from "./engine/change";
import { PatchSchema } from "./engine/validation";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODEL, PIPELINE, pendingChunks } from "./engine/extraction";
import type { Json } from "@/integrations/supabase/types";
import { checkCase } from "./engine/case-check";
const DateStr = QueryDate;
/** Challenge IDs encode the jurisdiction they refer to; mappings must match it independently of the mapped rule. */
function expectedIdentity(cid: string): { state: string; city: string | null } | null {
  const p = cid.split("-")[0];
  const m: Record<string, { state: string; city: string | null }> = { CA: { state: "CA", city: null }, NJ: { state: "NJ", city: null }, MA: { state: "MA", city: null }, HOB: { state: "NJ", city: "Hoboken" }, JC: { state: "NJ", city: "Jersey City" } };
  return (p && m[p]) || null;
}
const RANK: Record<string, number> = { applies: 4, unknown: 5, not_yet_effective: 3, pending: 2, superseded: 1 };


function applyPatch(rules: RuleLite[], ruleKey: string, patch: Patch): RuleLite[] {
  const defined = Object.fromEntries(Object.entries(patch).filter(([,value]) => value !== undefined)) as Partial<RuleLite>;
  return rules.map((r) => (r.rule_key === ruleKey ? { ...r, ...defined } : r));
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
    const best = outcomes.filter((o) => o.category === c && o.result).sort((a, b) => (RANK[b.result!] ?? 0) - (RANK[a.result!] ?? 0))[0];
    cats[c] = best?.result ?? null;
  }
  const mixed: Record<string, string[]> = {};
  for (const c of CATEGORIES) mixed[c] = Array.from(new Set(outcomes.filter((o) => o.category === c && o.result).map((o) => o.result!)));
  return {
    categories: cats,
    category_results: mixed,
    unknown_count: outcomes.filter((o) => o.result === "unknown").length,
    conflict: outcomes.some((o) => o.conflict_flag),
  };
}

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const active = await sb.from("dataset_versions").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  assertDb(active); const ds = active.data;
  if (!ds) return { dataset: null, counts: null };
  const [p, s, st, r, rv, ri, jr, jres] = await Promise.all([
    sb.from("properties").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id),
    sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id),
    sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", ds.id).eq("text_available", true),
    sb.from("rule_versions").select("id,source_documents!inner(dataset_id)", { count: "exact", head: true }).eq("source_documents.dataset_id", ds.id).eq("is_current", true),
    sb.from("rule_versions").select("id,source_documents!inner(dataset_id)", { count: "exact", head: true }).eq("source_documents.dataset_id", ds.id).eq("is_current", true).eq("review_state", "reviewed"),
    sb.from("rule_versions").select("id,source_documents!inner(dataset_id)", { count: "exact", head: true }).eq("source_documents.dataset_id", ds.id).eq("review_state", "invalid"),
    sb.from("jurisdiction_resolutions").select("id,properties!inner(dataset_id)", { count: "exact", head: true }).eq("properties.dataset_id", ds.id).eq("is_current", true),
    sb.from("jurisdiction_resolutions").select("id,properties!inner(dataset_id)", { count: "exact", head: true }).eq("properties.dataset_id", ds.id).eq("is_current", true).eq("status", "resolved"),
  ]);
  for (const result of [p,s,st,r,rv,ri,jr,jres]) assertDb(result);
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
        retrieved_at: ruleMap.get(o.rule_id)?.retrieved_at ?? null,
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

function compareRule(inp: EngineInputs, ruleKey: string, asA: string, rulesA: RuleLite[], asB: string, rulesB: RuleLite[]) {
  const A = evalAll(inp, asA, rulesA), B = evalAll(inp, asB, rulesB);
  return A.map((x, i) => {
    const a = x.outcomes.find((o) => o.rule_key === ruleKey) ?? null;
    const b = B[i]!.outcomes.find((o) => o.rule_key === ruleKey) ?? null;
    return {
      address_id: x.property.address_id, street: x.property.street_address, postal_city: x.property.postal_city, state: x.property.state,
      units: x.property.units,
      legal_city: x.resolution?.place_name ?? null, geo_status:x.resolution?.status ?? null, place_kind:x.resolution?.place_kind ?? null,
      before: a?.result ?? null, after: b?.result ?? null,
      conflict_after: b?.conflict_flag ?? false,
      label: diffLabel(a?.result ?? null, b?.result ?? null, rulesA.find(r=>r.rule_key===ruleKey), rulesB.find(r=>r.rule_key===ruleKey)),
      before_requirement: rulesA.find(r=>r.rule_key===ruleKey)?.requirement ?? null,
      after_requirement: rulesB.find(r=>r.rule_key===ruleKey)?.requirement ?? null,
      before_key_value: rulesA.find(r=>r.rule_key===ruleKey)?.key_value ?? null,
      after_key_value: rulesB.find(r=>r.rule_key===ruleKey)?.key_value ?? null,
    };
  });
}

function bucket(rows: ReturnType<typeof compareRule>) {
  const changed = rows.filter((r) => r.label !== "no_change");
  return {
    definitely_changed: changed.filter((r) => r.after !== "unknown" && r.before !== "unknown" && (r.after === "applies" || r.before === "applies")).length,
    potentially_affected: changed.filter((r) => r.after === "unknown" || r.before === "unknown").length,
    unchanged: rows.length - changed.length,
    known_units_changed: changed.reduce((s, r) => s + (r.units ?? 0), 0),
    unknown_units_properties: changed.filter((r) => r.units == null).length,
  };
}

async function runTests(inp: EngineInputs) {
  const sb = publicClient();
  const mapped = await sb.from("semantic_mappings").select("*");
  assertDb(mapped); const maps = mapped.data;
  const mapping = new Map((maps ?? []).map((m) => [m.challenge_rule_id, m.rule_key]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tests = (inp.dataset?.change_tests ?? []) as any[];
  return tests.map((t) => {
    const ids = (t.rule_ids as string[]) ?? [];
    const unmapped = ids.filter((id) => !mapping.get(id) || !inp.rules.some((r) => r.rule_key === mapping.get(id)));
    const base = { test_id: t.test_id as string, title: t.title as string, type: t.type as string, expected: t.expected_behavior as string, rule_ids: ids, mapping: Object.fromEntries(ids.map((i) => [i, mapping.get(i) ?? null])) };
    if (unmapped.length === ids.length) return { ...base, status: "incomplete" as const, note: `No extracted rule mapped for ${unmapped.join(", ")}. Map a challenge ID to an extracted rule in the reviewer workspace.`, per_rule: [] as Array<{ challenge_id: string; rule_key: string; rows: ReturnType<typeof compareRule>; summary: ReturnType<typeof bucket> }>, affected: [] as string[], conflicts: [] as string[] };
    const per_rule = ids.filter((i) => !unmapped.includes(i)).map((cid) => {
      const key = mapping.get(cid)!;
      let rows: ReturnType<typeof compareRule>;
      if (t.type === "as_of") rows = compareRule(inp, key, t.as_of_before as string, inp.rules, t.as_of_after as string, inp.rules);
      else if (t.type === "pending") rows = compareRule(inp, key, t.as_of as string, inp.rules, t.as_of as string, applyPatch(inp.rules, key, { legal_status: "enacted", effective_date: t.as_of as string }));
      else rows = compareRule(inp, key, t.as_of as string, inp.rules, t.as_of as string, inp.rules);
      const conflictCities=(t.conflict_with ?? []).map((id:string)=>inp.rules.find(r=>r.rule_key===mapping.get(id))?.city).filter((c: string|null|undefined):c is string=>!!c);
      const mappedRule=inp.rules.find(r=>r.rule_key===key)!;
      const check=checkCase(t,mappedRule,rows,conflictCities);
      const identity=expectedIdentity(cid);
      if(identity && !(mappedRule.state===identity.state && (identity.city ? normCity(mappedRule.city)===normCity(identity.city) : mappedRule.level==="state"))) {
        check.status="failed"; check.note=`Semantic mapping mismatch: ${cid} expects ${identity.city ?? identity.state+" statewide"}, but ${key} is ${mappedRule.city ?? mappedRule.state+" statewide"}. `+check.note;
      }
      if(t.type==="negative") {
        const bad=evalAll(inp,t.as_of as string).flatMap(x=>x.outcomes.filter(o=>o.category===mappedRule.category && (o.result==="applies"||o.result==="unknown") && x.property.state===mappedRule.state && inp.rules.find(r=>r.rule_key===o.rule_key)?.legal_status!=="enacted").map(()=>x.property.address_id));
        if(bad.length){check.status="failed";check.failed_address_ids=Array.from(new Set([...check.failed_address_ids,...bad]));check.note="Other non-enacted rules in this category still report results. "+check.note;}
      }
      if((t.conflict_with ?? []).length !== conflictCities.length && check.status!=="failed") check.status="unresolved";
      return { challenge_id: cid, rule_key: key, rows, summary: bucket(rows), check };
    });
    let affected: string[] = [];
    if (t.type === "boundary" || t.type === "negative") affected = per_rule.flatMap((r) => r.rows.filter((x) => x.after === "applies" || x.after === "unknown").map((x) => x.address_id));
    else affected = per_rule.flatMap((r) => r.rows.filter((x) => x.label !== "no_change").map((x) => x.address_id));
    const conflicts = per_rule.flatMap((r) => r.rows.filter((x) => x.conflict_after).map((x) => x.address_id));
    return {
      ...base,
      status: unmapped.length ? ("partial" as const) : ("evaluated" as const),
      note: unmapped.length ? `Unmapped: ${unmapped.join(", ")}` : t.type === "pending" ? "After = separately labeled hypothetical enactment effective on the test date; current status remains pending. This is a diagnostic, not a judge-verified result." : "Diagnostic evaluation only; expected behavior has not been independently verified against an answer key.",
      per_rule, affected: Array.from(new Set(affected)).sort(), conflicts: Array.from(new Set(conflicts)).sort(),
    };
  });
}

export const runChangeTests = createServerFn({ method: "GET" }).handler(async () => {
  const inp = await loadEngineInputs();
  const results = await runTests(inp);
  return results.map((r) => ({ ...r, per_rule: r.per_rule.map((p) => ({ ...p, rows: p.rows.filter((x) => x.label !== "no_change" || x.after) })) }));
});

export const runScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ scenarioId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const found = await sb.from("scenarios").select("*").eq("id", data.scenarioId).single();
    assertDb(found); const sc=found.data;
    if (!sc) throw new Error("Scenario not found");
    const selected = sc.base_rule_id ? await sb.from("rule_versions").select("*,source_documents(doc_id)").eq("id",sc.base_rule_id).single() : null;
    if(selected) assertDb(selected);
    if(!selected?.data) throw new Error("Legacy scenario has no frozen base version; recreate it");
    const inp = await loadEngineInputs();
    const baseRules=inp.rules.map(r=>r.rule_key===sc.rule_key?{...selected.data,source_doc_id:selected.data.source_documents?.doc_id} as RuleLite:r);
    if(!baseRules.some(r=>r.rule_key===sc.rule_key)) throw new Error("Scenario belongs to a different dataset");
    const patched = applyPatch(baseRules, sc.rule_key, PatchSchema.parse(sc.patch));
    const rows = compareRule(inp, sc.rule_key, sc.as_of, baseRules, sc.as_of, patched);
    return { scenario: sc, rows: rows.filter((r) => r.label !== "no_change" || r.after), summary: bucket(rows), sample_size: rows.length };
  });

export const exportSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: z.enum(["rules", "lookups", "changes"]), diagnostic: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const {supabase:staff,userId} = context;
    const roles = await staff.from("user_roles").select("role").eq("user_id",userId); assertDb(roles);
    if(!roles.data?.some(r=>r.role==="admin" || r.role==="reviewer")) throw new Error("Staff permission required");
    const inp = await loadEngineInputs();
    if(!inp.dataset || inp.properties.length!==500 || !inp.rules.length) throw new Error("Export unavailable: import the supplied package and extract rules first");
    const sources = await readAll(staff.from("source_documents").select("id,text,text_available,local_sha256,manifest_sha256,retrieved_at").eq("dataset_id",inp.dataset.id));
    const runs = await readAll(staff.from("extraction_runs").select("source_id,chunk_index,chunk_count,status,pipeline_version,model,created_at").eq("pipeline_version",PIPELINE));
    assertDb(sources); assertDb(runs);
    const incomplete=(sources.data??[]).filter(s=>s.text_available && pendingChunks(s.text?.length??0,(runs.data??[]).filter(r=>r.source_id===s.id)).length);
    if(!data.diagnostic && data.kind!=="changes" && (sources.data?.length!==87 || incomplete.length)) throw new Error(`Submission blocked: ${incomplete.length} sources have unfinished extraction. Use diagnostic export while completing review.`);
    const tests = await runTests(inp);
    if(!data.diagnostic && data.kind==="changes" && tests.some(t=>t.status!=="evaluated" || t.per_rule.some(p=>!("check" in p) || (p.check as {status:string}).status!=="passed"))) throw new Error("Submission blocked: change-case mappings or specification checks are incomplete, unresolved or failed");
    const finishExport = async (artifact: Json) => {
      const capturedAt = new Date().toISOString();
      const snapshot = {dataset_id:inp.dataset!.id,upload_sha256:inp.dataset!.upload_sha256,as_of:DEFAULT_AS_OF,
        properties:inp.properties,resolutions:Array.from(inp.resolutions.entries()),rules:inp.rules,relations:inp.relations,
        sources:(sources.data??[]).map(({text:_text,...s})=>s)};
      const payload=canonicalJson({snapshot,artifact});
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
      const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
      const saved=await staff.from("audit_log").insert({actor:userId,action:"export.snapshot",entity:"dataset_versions",entity_id:inp.dataset!.id,
        detail:JSON.parse(JSON.stringify({kind:data.kind,diagnostic:data.diagnostic,capturedAt,hash,snapshot,artifact}))}).select("id").single();
      assertDb(saved);
      return {artifact,receipt:{export_id:saved.data!.id,kind:data.kind,diagnostic:data.diagnostic,captured_at:capturedAt,
        as_of:DEFAULT_AS_OF,dataset_id:inp.dataset!.id,upload_sha256:inp.dataset!.upload_sha256,snapshot_and_artifact_sha256:hash,hash_format:"canonical-json-v1",
        properties:inp.properties.length,rules:inp.rules.length,unfinished_sources:incomplete.length,
        note:"Frozen evaluator input and artifact stored in the staff audit log. Quote validation is not legal verification; no official answer-key score is available."}};
    };
    if (data.kind === "rules") {
      return finishExport({
        rules: inp.rules.filter((r) => r.review_state !== "invalid").map((r) => {
          const lc = lifecycleOn(r, DEFAULT_AS_OF);
          if(!data.diagnostic && (lc==="unknown" || lc==="repealed")) throw new Error(`Rule ${r.rule_key} has no supported submission lifecycle; review its status and dates`);
          const rels = inp.relations.filter((x) => x.from_rule_key === r.rule_key || x.to_rule_key === r.rule_key);
          return {
            team_rule_id: r.rule_key, jurisdiction: r.jurisdiction, level: r.level, category: r.category,
            status: lc === "future" ? "not_yet_effective" : lc === "pending" ? "pending" : lc === "failed" ? "failed" : lc === "in_force" ? "in_force" : "unknown",
            title: r.title, requirement: r.requirement, key_value: r.key_value,
            coverage_conditions: (r.coverage as Json) ?? r.coverage_text ?? (r.coverage_status === "unconditional" ? null : "Coverage not established; human review required"),
            exemptions: r.exemptions ? JSON.stringify(r.exemptions) : r.exemptions_text ?? (r.exemptions_status === "none" ? null : "Exemptions not established; human review required"),
            overrides: rels.filter(x=>x.from_rule_key===r.rule_key && ["replaces","stricter-local-standard"].includes(x.relation_type)).map(x=>x.to_rule_key),
            interaction: rels.map((x) => `${x.from_rule_key} ${x.relation_type} ${x.to_rule_key}`).join("; ") || null,
            effective_date: r.effective_date, citation: r.citation, source_doc_id: r.source_doc_id ?? null,
            source_url: r.source_url ?? "", quoted_span: r.quoted_span, confidence: r.confidence,
            conflict_flag: rels.some((x) => x.relation_type === "possible-preemption" || x.relation_type === "unresolved-conflict"),
            conflict_note: null,
          };
        }),
      });
    }
    if (data.kind === "lookups") {
      const lookups: Record<string, Array<{ team_rule_id: string; result: string | null; explanation: string; conflict_flag: boolean }>> = {};
      for (const x of evalAll(inp, DEFAULT_AS_OF)) {
        lookups[x.property.address_id] = x.outcomes.filter((o) => o.result).map((o) => ({ team_rule_id: o.rule_key, result: o.result, explanation: o.explanation, conflict_flag: o.conflict_flag }));
      }
      return finishExport({ as_of: DEFAULT_AS_OF, lookups });
    }
    const out: Record<string, { affected_address_ids: string[]; conflict_flag_address_ids: string[]; notes: string }> = {};
    for (const t of tests) out[t.test_id] = { affected_address_ids: t.affected, conflict_flag_address_ids: t.conflicts, notes: `${t.status}. ${t.note}`.trim() };
    return finishExport(out);
  });
