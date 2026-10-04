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

export async function loadEngineInputs(): Promise<EngineInputs> {
  const sb = publicClient();
  const active = await sb.from("dataset_versions").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  assertDb(active);
  const ds = active.data;
  if (!ds) return { dataset: null, properties: [], resolutions: new Map(), rules: [], relations: [] };
  const [props, res, rules, rels] = await Promise.all([
    readAll(sb.from("properties").select("id,address_id,street_address,postal_city,state,zip,year_built,units,use_code,use_description").eq("dataset_id", ds.id).order("address_id")),
    readAll(sb.from("jurisdiction_resolutions").select("property_id,status,place_name,place_kind,county_name,lat,lon").eq("is_current", true)),
    readAll(sb.from("rule_versions").select("*, source_documents!inner(doc_id,dataset_id,retrieved_at)").eq("is_current", true).eq("source_documents.dataset_id", ds.id)),
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
    rules: (rules.data ?? []).map((r) => ({
      ...r,
      confidence: r.confidence === null ? null : Number(r.confidence),
      source_doc_id: (r as unknown as { source_documents: { doc_id: string } }).source_documents?.doc_id ?? null,
      retrieved_at: r.source_documents.retrieved_at,
    })) as RuleLite[],
    relations: (rels.data ?? []).filter(r => keys.has(r.from_rule_key) && keys.has(r.to_rule_key)),
  };
}
