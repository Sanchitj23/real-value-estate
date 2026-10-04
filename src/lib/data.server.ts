import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PropertyLite, RelationLite, ResolutionLite, RuleLite } from "./engine/applicability";

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
  const { data: ds } = await sb.from("dataset_versions").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ds) return { dataset: null, properties: [], resolutions: new Map(), rules: [], relations: [] };
  const [props, res, rules, rels] = await Promise.all([
    sb.from("properties").select("id,address_id,street_address,postal_city,state,zip,year_built,units,use_code,use_description").eq("dataset_id", ds.id).order("address_id").limit(2000),
    sb.from("jurisdiction_resolutions").select("property_id,status,place_name,place_kind,county_name,lat,lon").eq("is_current", true).limit(5000),
    sb.from("rule_versions").select("*, source_documents!inner(doc_id,dataset_id)").eq("is_current", true).eq("source_documents.dataset_id", ds.id).limit(5000),
    sb.from("rule_relations").select("from_rule_key,to_rule_key,relation_type,note").limit(1000),
  ]);
  const resolutions = new Map<string, NonNullable<ResolutionLite>>();
  for (const r of res.data ?? []) resolutions.set(r.property_id, r);
  return {
    dataset: ds,
    properties: props.data ?? [],
    resolutions,
    rules: (rules.data ?? []).map((r) => ({
      ...r,
      confidence: r.confidence === null ? null : Number(r.confidence),
      source_doc_id: (r as unknown as { source_documents: { doc_id: string } }).source_documents?.doc_id ?? null,
    })) as RuleLite[],
    relations: rels.data ?? [],
  };
}
