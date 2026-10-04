import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ExprSchema, FACT_KEYS } from "./engine/expr";
import { CATEGORIES } from "./engine/applicability";
import { findQuote } from "./engine/quote";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function requireStaff(ctx: Ctx, adminOnly = false) {
  const { data } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  const ok = adminOnly ? roles.includes("admin") : roles.includes("admin") || roles.includes("reviewer");
  if (!ok) throw new Error(adminOnly ? "Admin permission required" : "Reviewer permission required");
}
async function audit(ctx: Ctx, action: string, entity: string, entity_id: string | null, detail: unknown) {
  await ctx.supabase.from("audit_log").insert({ actor: ctx.userId, action, entity, entity_id, detail: detail as object });
}

/* ---------------- Import ---------------- */

export const importStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    upload_sha256: z.string().length(64),
    format_version: z.string().startsWith("housing-law-bootstrap/"),
    package_metadata: z.record(z.any()) as z.ZodType<Any>,
    known_gaps: z.array(z.any()),
    change_tests: z.array(z.any()).length(5),
    rule_record_schema: z.record(z.any()),
    counts: z.record(z.number()) as z.ZodType<Any>,
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx, true);
    const { data: existing } = await ctx.supabase.from("dataset_versions").select("id,status").eq("upload_sha256", data.upload_sha256).maybeSingle();
    if (existing?.status === "active") return { datasetId: existing.id as string, alreadyActive: true };
    if (existing) return { datasetId: existing.id as string, alreadyActive: false };
    const { data: row, error } = await ctx.supabase.from("dataset_versions").insert({
      upload_sha256: data.upload_sha256, format_version: data.format_version,
      package_name: (data.package_metadata.source_package_name as string) ?? null,
      default_as_of: (data.package_metadata.default_as_of as string) ?? "2026-10-01",
      counts: data.counts, package_metadata: data.package_metadata, known_gaps: data.known_gaps,
      change_tests: data.change_tests, rule_record_schema: data.rule_record_schema, status: "staging", created_by: ctx.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await audit(ctx, "import.start", "dataset_versions", row.id as string, { sha: data.upload_sha256 });
    return { datasetId: row.id as string, alreadyActive: false };
  });

const PropRow = z.object({
  address_id: z.string().regex(/^A\d+$/), street_address: z.string().min(1), postal_city: z.string().nullable(),
  state: z.enum(["CA", "NJ", "MA"]), zip: z.string().nullable(), year_built: z.number().int().nullable(),
  units: z.number().int().nullable(), use_code: z.string().nullable(), use_description: z.string().nullable(),
  source_dataset: z.string().nullable(), retrieved_at: z.string().nullable(), original_csv_row: z.record(z.any()),
});

export const importProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ datasetId: z.string().uuid(), rows: z.array(PropRow).max(600) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx, true);
    const rows = data.rows.map(({ original_csv_row, ...r }) => ({ ...r, raw_row: original_csv_row, dataset_id: data.datasetId }));
    const { error } = await ctx.supabase.from("properties").upsert(rows, { onConflict: "dataset_id,address_id" });
    if (error) throw new Error(error.message);
    return { accepted: rows.length };
  });

const SourceRow = z.object({
  doc_id: z.string().regex(/^D\d{3}$/), manifest_row: z.record(z.string()) as z.ZodType<Any>, supplied_text_available: z.boolean(),
  text: z.string().nullable(), local_text_sha256: z.string().nullable(), manifest_hash_matches_local: z.boolean().nullable(),
  link_only_row: z.record(z.any()).nullable(),
});

export const importSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ datasetId: z.string().uuid(), rows: z.array(SourceRow).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx, true);
    const rows = data.rows.map((s) => ({
      dataset_id: data.datasetId, doc_id: s.doc_id, jurisdictions: s.manifest_row.jurisdictions ?? null,
      url: s.manifest_row.url ?? null, source_type: s.manifest_row.source_type ?? null, capture: s.manifest_row.capture ?? null,
      retrieved_at: s.manifest_row.retrieved_at ?? null, manifest_sha256: s.manifest_row.sha256 || null,
      local_sha256: s.local_text_sha256, hash_matches: s.manifest_hash_matches_local,
      text_available: s.supplied_text_available && !!s.text, text: s.text, manifest_row: s.manifest_row, link_only_row: s.link_only_row,
    }));
    const { error } = await ctx.supabase.from("source_documents").upsert(rows, { onConflict: "dataset_id,doc_id" });
    if (error) throw new Error(error.message);
    return { accepted: rows.length };
  });

export const importFinish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ datasetId: z.string().uuid(), expected: z.record(z.number()) as z.ZodType<Any> }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx, true);
    const sb = ctx.supabase;
    const [p, s, t] = await Promise.all([
      sb.from("properties").select("id", { count: "exact", head: true }).eq("dataset_id", data.datasetId),
      sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", data.datasetId),
      sb.from("source_documents").select("id", { count: "exact", head: true }).eq("dataset_id", data.datasetId).eq("text_available", true),
    ]);
    const { data: missing } = await sb.from("source_documents").select("doc_id,jurisdictions,source_type").eq("dataset_id", data.datasetId).eq("text_available", false).order("doc_id");
    const receipt = {
      properties: p.count, sources: s.count, captured_texts: t.count, link_only_or_missing: (s.count ?? 0) - (t.count ?? 0),
      expected: data.expected,
      missing_texts: (missing ?? []).map((m: { doc_id: string }) => m.doc_id),
      provenance_note: "Manifest SHA256 values do not match local text-file hashes; both preserved, provenance unresolved.",
      ok: p.count === data.expected.properties && s.count === data.expected.sources && t.count === data.expected.captured,
      completed_at: new Date().toISOString(),
    };
    if (!receipt.ok) {
      await sb.from("dataset_versions").update({ receipt, status: "failed" }).eq("id", data.datasetId);
      throw new Error(`Import counts do not match expected: ${JSON.stringify(receipt)}`);
    }
    await sb.from("dataset_versions").update({ status: "archived" }).eq("status", "active");
    await sb.from("dataset_versions").update({ receipt, status: "active" }).eq("id", data.datasetId);
    await audit(ctx, "import.finish", "dataset_versions", data.datasetId, receipt);
    return receipt;
  });

/* ---------------- Extraction ---------------- */

const PIPELINE = "extract-v1";
const MODEL = "openai/gpt-6-astra";
const CHUNK = 40000, OVERLAP = 1500;

export function chunkCount(len: number) { return Math.max(1, Math.ceil((len - OVERLAP) / (CHUNK - OVERLAP))); }

const nstr = { type: ["string", "null"] };
const ruleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          title: { type: "string" },
          requirement: { type: "string", description: "One or two plain-language sentences." },
          key_value: { ...nstr, description: "Headline number/formula, e.g. 'lesser of 5%+CPI or 10%'." },
          citation: { type: "string", description: "Official cite (code section, ordinance number, bill)." },
          legal_status: { type: "string", enum: ["enacted", "pending", "failed", "repealed", "unknown"], description: "From the text only." },
          enacted_date: { ...nstr, description: "YYYY-MM-DD or YYYY if stated." },
          effective_date: { ...nstr, description: "YYYY-MM-DD, YYYY-MM or YYYY when the text states an operative date." },
          expiry_date: nstr,
          coverage_text: nstr,
          exemptions_text: nstr,
          coverage_expr_json: { ...nstr, description: "JSON string of a condition tree, or null if covering all residential rentals in the jurisdiction." },
          exemptions_expr_json: { ...nstr, description: "JSON string of a condition tree; true means exempt." },
          interaction_text: { ...nstr, description: "Stated relation to other laws (preemption, stricter local rules)." },
          quoted_span: { type: "string", description: "EXACT verbatim text copied from the document (min 20 chars) supporting the requirement." },
          supporting_quotes: {
            type: "array",
            items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, quote: { type: "string" } }, required: ["field", "quote"] },
          },
          confidence: { type: "number" },
        },
        required: ["category", "title", "requirement", "key_value", "citation", "legal_status", "enacted_date", "effective_date", "expiry_date", "coverage_text", "exemptions_text", "coverage_expr_json", "exemptions_expr_json", "interaction_text", "quoted_span", "supporting_quotes", "confidence"],
      },
    },
  },
  required: ["rules"],
};

/** Streams a Responses API call and returns the concatenated output text. */
async function callModel(system: string, user: string): Promise<string> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": process.env["LOVABLE_API_KEY"] ?? "", "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL,
      instructions: system,
      input: [{ role: "user", content: user }],
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      text: { format: { type: "json_schema", name: "record_rules", strict: true, schema: ruleSchema } },
    }),
  });
  if (!resp.ok || !resp.body) {
    const body = await resp.text().catch(() => "");
    throw new Error(resp.status === 429 ? "AI rate limit reached — wait and resume." : resp.status === 402 ? "AI credits exhausted — add credits in workspace billing." : `AI error ${resp.status}: ${body.slice(0, 300)}`);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", completed = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: { type?: string; delta?: string; error?: { message?: string }; response?: { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; error?: { message?: string } } };
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "response.output_text.delta" && ev.delta) out += ev.delta;
      else if (ev.type === "error" || ev.type === "response.failed") throw new Error(ev.error?.message ?? ev.response?.error?.message ?? "AI stream failed");
      else if (ev.type === "response.completed") {
        completed = (ev.response?.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      }
    }
  }
  const text = out || completed;
  if (!text) throw new Error("AI returned empty output");
  return text;
}

const SYSTEM = `You extract structured rental-housing rules from a supplied legal text for a research prototype.
Categories: ${CATEGORIES.join(", ")}. Ignore provisions outside these categories.
Rules:
- Quotes MUST be copied verbatim from the document text. Never paraphrase inside a quote.
- Use only what the text states. Do not use outside knowledge for dates or status. If uncertain, use "unknown"/null.
- Condition trees use ONLY these operators: all, any (children: [...]), not (children: [one]), eq, neq, lt, lte, gt, gte (fact, value), in (fact, value:[...]), manual_review (reason).
- Allowed facts: ${FACT_KEYS.join(", ")}.
- Construction year is not a certificate-of-occupancy date: use property.certificate_of_occupancy_year when the law refers to certificates of occupancy.
- Building unit count (property.units) is different from owner portfolio size (ownership.portfolio_units).
- If a condition cannot be expressed, use {"operator":"manual_review","reason":"..."}.
Example tree (synthetic): {"operator":"all","children":[{"operator":"gte","fact":"property.units","value":2}]}`;

export const extractSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sourceId: z.string().uuid(), chunkIndex: z.number().int().min(0).default(0) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const sb = ctx.supabase;
    const { data: src } = await sb.from("source_documents").select("id,doc_id,jurisdictions,url,text").eq("id", data.sourceId).single();
    const source = src as { id: string; doc_id: string; jurisdictions: string | null; url: string | null; text: string | null } | null;
    if (!source?.text) throw new Error("No supplied text for this source; extraction unavailable.");
    const text = source.text;
    const n = chunkCount(text.length);
    const start = data.chunkIndex * (CHUNK - OVERLAP);
    const chunk = text.slice(start, start + CHUNK);

    const { data: run } = await sb.from("extraction_runs").insert({
      source_id: source.id, model: MODEL, pipeline_version: PIPELINE, chunk_index: data.chunkIndex, chunk_count: n, created_by: ctx.userId,
    }).select("id").single();
    const runId = (run as Any).id as string;

    // Jurisdiction comes from the manifest, not the model.
    const j = (source.jurisdictions ?? "").trim();
    const isCity = j.includes(",");
    const state = isCity ? (j.split(",")[1] ?? "").trim() : j;
    const city = isCity ? (j.split(",")[0] ?? "").trim() : null;

    let candidates: Any[] = [];
    try {
      const out = await callModel(SYSTEM, `Document ${source.doc_id} (jurisdiction per manifest: ${j}; part ${data.chunkIndex + 1} of ${n}).\n<document>\n${chunk}\n</document>`);
      candidates = JSON.parse(out).rules ?? [];
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("extraction_runs").update({ status: "error", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
      throw new Error(msg);
    }

    let valid = 0, invalid = 0;
    for (const c of candidates) {
      const errors: string[] = [];
      const category = String(c.category);
      if (!CATEGORIES.includes(category as never)) errors.push("invalid category");
      const quote = String(c.quoted_span ?? "");
      if (quote.length < 20) errors.push("quoted_span shorter than 20 chars");
      const m = findQuote(text, quote);
      if (!m) errors.push("quoted_span not found in source text");
      const parseExpr = (s: unknown, field: string) => {
        if (s == null || s === "" || s === "null") return null;
        try {
          const r = ExprSchema.safeParse(JSON.parse(String(s)));
          if (r.success) return r.data;
          errors.push(`${field}: expression failed schema validation`);
        } catch { errors.push(`${field}: not valid JSON`); }
        return { operator: "manual_review", reason: `${field} could not be validated; see text` };
      };
      const coverage = parseExpr(c.coverage_expr_json, "coverage");
      const exemptions = parseExpr(c.exemptions_expr_json, "exemptions");
      const dateOk = (v: unknown) => v == null || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v));
      for (const f of ["enacted_date", "effective_date", "expiry_date"]) if (!dateOk(c[f])) { errors.push(`${f} malformed`); c[f] = null; }
      const fatal = !m || quote.length < 20 || !CATEGORIES.includes(category as never);
      const title = String(c.title ?? "Untitled").slice(0, 200);
      const rule_key = `${source.doc_id}:${category}:${slug(title)}`;

      const { data: prev } = await sb.from("rule_versions").select("id,version").eq("rule_key", rule_key).eq("is_current", true).maybeSingle();
      const p = prev as { id: string; version: number } | null;
      if (p) await sb.from("rule_versions").update({ is_current: false }).eq("id", p.id);
      const { data: ins, error } = await sb.from("rule_versions").insert({
        rule_key, version: (p?.version ?? 0) + 1, supersedes: p?.id ?? null, run_id: runId, source_id: source.id,
        state, level: isCity ? "city" : "state", city, jurisdiction: isCity ? `${city}, ${state}` : state,
        category: fatal && !CATEGORIES.includes(category as never) ? "rent_increase_limits" : category,
        title, requirement: String(c.requirement ?? ""), key_value: (c.key_value as string) ?? null,
        citation: String(c.citation ?? source.doc_id), source_url: source.url,
        legal_status: ["enacted", "pending", "failed", "repealed"].includes(String(c.legal_status)) ? String(c.legal_status) : "unknown",
        enacted_date: (c.enacted_date as string) ?? null, effective_date: (c.effective_date as string) ?? null, expiry_date: (c.expiry_date as string) ?? null,
        coverage, exemptions, coverage_text: (c.coverage_text as string) ?? null, exemptions_text: (c.exemptions_text as string) ?? null,
        interaction_text: (c.interaction_text as string) ?? null,
        quoted_span: m ? text.slice(m.start, m.end) : quote,
        confidence: typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : null,
        review_state: fatal ? "invalid" : "validated_auto", validation_errors: errors, created_by: ctx.userId,
        change_reason: p ? "Automated re-extraction" : null,
      }).select("id").single();
      if (error) { invalid++; continue; }
      const rvId = (ins as { id: string }).id;
      const ev = [{ field: "quoted_span", quote }, ...(((c.supporting_quotes as Array<{ field: string; quote: string }>) ?? []).slice(0, 6))];
      await sb.from("rule_evidence").insert(ev.map((e) => {
        const mm = findQuote(text, e.quote);
        return { rule_version_id: rvId, field: e.field, quote: mm ? text.slice(mm.start, mm.end) : e.quote, start_offset: mm?.start ?? null, end_offset: mm?.end ?? null, match_kind: mm?.kind ?? "not_found", valid: !!mm };
      }));
      if (fatal) invalid++; else valid++;
    }
    await sb.from("extraction_runs").update({ status: "done", candidates: candidates.length, valid, invalid, raw_output: { candidates } as object, finished_at: new Date().toISOString() }).eq("id", runId);
    await audit(ctx, "extract.run", "source_documents", source.doc_id, { runId, chunk: data.chunkIndex, valid, invalid });
    return { runId, chunkIndex: data.chunkIndex, chunkCount: n, candidates: candidates.length, valid, invalid, done: data.chunkIndex + 1 >= n };
  });

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); }

/* ---------------- Geocoding ---------------- */

export const geocodeBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ propertyIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const sb = ctx.supabase;
    const { data: props } = await sb.from("properties").select("id,address_id,street_address,state,zip").in("id", data.propertyIds);
    const out = await Promise.all(((props ?? []) as Array<{ id: string; address_id: string; street_address: string; state: string; zip: string | null }>).map(async (p) => {
      const qs = new URLSearchParams({ street: p.street_address, state: p.state, zip: p.zip ?? "", benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" });
      const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?${qs}`;
      let row: Record<string, unknown>;
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const matches = j.result?.addressMatches ?? [];
        if (!matches.length) row = { status: "no_match", warnings: ["Census geocoder returned no match for street/state/ZIP"] };
        else {
          const m = matches[0];
          const g = m.geographies ?? {};
          const inc = g["Incorporated Places"]?.[0];
          const cdp = g["Census Designated Places"]?.[0];
          const county = g["Counties"]?.[0];
          const warnings: string[] = [];
          const places = new Set(matches.map((x: { geographies?: Record<string, Array<{ NAME: string }>> }) => x.geographies?.["Incorporated Places"]?.[0]?.NAME ?? "none"));
          if (matches.length > 1) warnings.push(`${matches.length} candidate matches`);
          if (m.addressComponents?.state && m.addressComponents.state !== p.state) warnings.push("State in match differs from supplied state");
          if (m.addressComponents?.zip && p.zip && m.addressComponents.zip !== p.zip) warnings.push(`Matched ZIP ${m.addressComponents.zip} differs from supplied ${p.zip}`);
          row = {
            status: places.size > 1 ? "ambiguous" : "resolved",
            lat: m.coordinates?.y ?? null, lon: m.coordinates?.x ?? null, matched_address: m.matchedAddress ?? null,
            county_name: county?.NAME ?? null,
            place_name: inc?.BASENAME ?? inc?.NAME ?? cdp?.BASENAME ?? null,
            place_geoid: inc?.GEOID ?? cdp?.GEOID ?? null,
            place_kind: inc ? "incorporated" : cdp ? "cdp" : "none",
            warnings, evidence: { input: { street: p.street_address, state: p.state, zip: p.zip }, match: m, request: url },
          };
        }
      } catch (e) {
        row = { status: "error", warnings: [String((e as Error).message)] };
      }
      await sb.from("jurisdiction_resolutions").update({ is_current: false }).eq("property_id", p.id).eq("is_current", true);
      await sb.from("jurisdiction_resolutions").insert({ property_id: p.id, benchmark: "Public_AR_Current", vintage: "Current_Current", created_by: ctx.userId, ...row } as never);
      return { address_id: p.address_id, status: row.status };
    }));
    return out;
  });

/* ---------------- Review ---------------- */

export const reviseRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    ruleId: z.string().uuid(),
    reason: z.string().min(5),
    review_state: z.enum(["reviewed", "invalid", "validated_auto"]),
    changes: z.object({
      title: z.string().optional(), requirement: z.string().optional(), key_value: z.string().nullable().optional(),
      legal_status: z.enum(["enacted", "pending", "failed", "repealed", "unknown"]).optional(),
      effective_date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
      category: z.enum(CATEGORIES).optional(),
      coverage: ExprSchema.nullable().optional(), exemptions: ExprSchema.nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const sb = ctx.supabase;
    const { data: cur } = await sb.from("rule_versions").select("*").eq("id", data.ruleId).single();
    const c = cur as Record<string, unknown> & { id: string; version: number; is_current: boolean; rule_key: string };
    if (!c?.is_current) throw new Error("Only the current version can be revised");
    const { id: _id, created_at: _ca, ...rest } = c;
    await sb.from("rule_versions").update({ is_current: false }).eq("id", c.id);
    const { data: ins, error } = await sb.from("rule_versions").insert({
      ...rest, ...data.changes, version: c.version + 1, supersedes: c.id, is_current: true,
      review_state: data.review_state, change_reason: data.reason, created_by: ctx.userId, run_id: null,
    } as never).select("id").single();
    if (error) { await sb.from("rule_versions").update({ is_current: true }).eq("id", c.id); throw new Error(error.message); }
    const newId = (ins as { id: string }).id;
    const { data: ev } = await sb.from("rule_evidence").select("field,quote,start_offset,end_offset,match_kind,valid").eq("rule_version_id", c.id);
    if (ev?.length) await sb.from("rule_evidence").insert((ev as object[]).map((e) => ({ ...e, rule_version_id: newId })));
    await audit(ctx, "rule.revise", "rule_versions", newId, { from: c.id, reason: data.reason, changes: data.changes, review_state: data.review_state });
    return { id: newId };
  });

export const setMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ challengeId: z.string(), ruleKey: z.string().nullable(), note: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    await ctx.supabase.from("semantic_mappings").upsert({ challenge_rule_id: data.challengeId, rule_key: data.ruleKey, note: data.note ?? null, mapped_by: ctx.userId, mapped_at: new Date().toISOString() });
    await audit(ctx, "mapping.set", "semantic_mappings", data.challengeId, data);
    return { ok: true };
  });

export const addRelation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    from_rule_key: z.string(), to_rule_key: z.string(),
    relation_type: z.enum(["replaces", "stricter-local-standard", "explicit-exception", "complementary", "possible-preemption", "unresolved-conflict"]),
    note: z.string().min(3), evidence_quote: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const { error } = await ctx.supabase.from("rule_relations").insert({ ...data, created_by: ctx.userId });
    if (error) throw new Error(error.message);
    await audit(ctx, "relation.add", "rule_relations", null, data);
    return { ok: true };
  });

export const createScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().min(3), description: z.string().optional(), rule_key: z.string(),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    patch: z.object({ legal_status: z.enum(["enacted", "pending", "failed", "repealed"]).optional(), effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const { data: row, error } = await ctx.supabase.from("scenarios").insert({ ...data, created_by: ctx.userId }).select("id").single();
    if (error) throw new Error(error.message);
    await audit(ctx, "scenario.create", "scenarios", (row as { id: string }).id, data);
    return { id: (row as { id: string }).id };
  });

export const grantReviewer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx, true);
    await ctx.supabase.from("user_roles").upsert({ user_id: data.userId, role: "reviewer" }, { onConflict: "user_id,role" });
    return { ok: true };
  });
