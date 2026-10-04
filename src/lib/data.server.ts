import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PropertyLite, RelationLite, ResolutionLite, RuleLite } from "./engine/applicability";
import { assertDb, readAll } from "./db-result";
export { assertDb } from "./db-result";

/** Server-side read client with the publishable key (RLS applies: public sample reads only). */
export function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type EngineInputs = {
  dataset: Database["public"]["Tables"]["dataset_versions"]["Row"] | null;
  properties: PropertyLite[];
  resolutions: Map<string, NonNullable<ResolutionLite>>;
  rules: RuleLite[];
  relations: RelationLite[];
};

export type RuleRow = Database["public"]["Tables"]["rule_versions"]["Row"] & {
  source_documents?: { doc_id: string; retrieved_at?: string | null } | null;
  rule_evidence?: Array<{ field: string; quote: string; valid: boolean }> | null;
};

/** Database row -> engine rule. Evidence rows are reduced to the one clause the engine needs. */
export function toRuleLite(row: RuleRow): RuleLite {
  const { rule_evidence, source_documents, ...r } = row;
  return {
    ...r,
    confidence: r.confidence === null ? null : Number(r.confidence),
    source_doc_id: source_documents?.doc_id ?? null,
    retrieved_at: source_documents?.retrieved_at ?? null,
    effective_clause: r.effective_date ? null : rule_evidence?.find((e) => e.field === "effective_date" && e.valid)?.quote ?? null,
  } as RuleLite;
}

// The local demo (`npm run demo`) keeps one load for ten minutes so a recording never waits on the database twice.
const CACHE_MS = import.meta.env.MODE === "demo" ? 600_000 : 15_000;
let cached: { at: number; value: Promise<EngineInputs> } | null = null;

/**
 * Engine inputs for the active dataset. Pages ask for these several times at once (list, map, law changes), so one
 * load is shared for a few seconds; a failed load is never kept. Staff jobs may take up to that long to show.
 */
export function loadEngineInputs(): Promise<EngineInputs> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = readEngineInputs();
  const entry = { at: Date.now(), value };
  cached = entry;
  value.catch(() => { if (cached === entry) cached = null; });
  return value;
}

async function readEngineInputs(): Promise<EngineInputs> {
  const sb = publicClient();
  const active = await sb.from("dataset_versions").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  assertDb(active);
  const ds = active.data;
  if (!ds) return { dataset: null, properties: [], resolutions: new Map(), rules: [], relations: [] };
  const [props, res, rules, rels] = await Promise.all([
    readAll(sb.from("properties").select("id,address_id,street_address,postal_city,state,zip,year_built,units,use_code,use_description").eq("dataset_id", ds.id).order("address_id")),
    readAll(sb.from("jurisdiction_resolutions").select("property_id,status,place_name,place_kind,county_name,lat,lon").eq("is_current", true)),
    readAll(sb.from("rule_versions").select("*, source_documents!inner(doc_id,dataset_id,retrieved_at), rule_evidence(field,quote,valid)").eq("is_current", true).eq("source_documents.dataset_id", ds.id)),
    readAll(sb.from("rule_relations").select("from_rule_key,to_rule_key,relation_type,note")),
  ]);
  for (const result of [props, res, rules, rels]) assertDb(result);
  if ((props.data?.length ?? 0) >= 2000 || (rules.data?.length ?? 0) >= 5000 || (rels.data?.length ?? 0) >= 1000) throw new Error("Dataset exceeds query limits; refusing a truncated report");
  const ids = new Set((props.data ?? []).map(p => p.id));
  const keys = new Set((rules.data ?? []).map(r => r.rule_key));
  const resolutions = new Map<string, NonNullable<ResolutionLite>>();
  for (const r of res.data ?? []) if (ids.has(r.property_id)) resolutions.set(r.property_id, r);
  return {
    dataset: ds,
    properties: props.data ?? [],
    resolutions,
    rules: (rules.data ?? []).map((r) => toRuleLite(r as unknown as RuleRow)),
    relations: (rels.data ?? []).filter(r => keys.has(r.from_rule_key) && keys.has(r.to_rule_key)),
  };
}
