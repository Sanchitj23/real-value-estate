import { requireStaffPage } from "@/lib/staff-guard";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { importStart, importProperties, importSources, importFinish, extractSource, geocodeBatch, getExtractionPlan } from "@/lib/admin.functions";
import { exportSubmission, getOverview } from "@/lib/engine.functions";
import { Disclaimer, PageHeader, Stat, download } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: () => requireStaffPage(false),
  head: () => ({
    meta: [
      { title: "Admin — import, extraction & jobs — Housing Law Navigator" },
      { name: "description", content: "Import the supplied bootstrap dataset, run automated extraction and jurisdiction resolution, and export submission files." },
      { property: "og:title", content: "Admin — Housing Law Navigator" },
      { property: "og:description", content: "Dataset import, extraction and geocoding jobs, and exports." },
    ],
  }),
  component: Admin,
});

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function Admin() {
  const { session, isAdmin, isStaff, ready } = useAuth();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => getOverview() });
  const fStart = useServerFn(importStart), fProps = useServerFn(importProperties), fSrc = useServerFn(importSources), fFinish = useServerFn(importFinish);
  const fPlan = useServerFn(getExtractionPlan);
  const fExtract = useServerFn(extractSource), fGeo = useServerFn(geocodeBatch), fExport = useServerFn(exportSubmission);
  const [busy,setBusy] = useState(false);
  const runJob = async (action:()=>Promise<void>) => { if(busy) return; setBusy(true); try{await action()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)} };
  const [job, setJob] = useState<{ label: string; done: number; total: number; log: string[] } | null>(null);
  const [stop, setStop] = useState(false);
  const stopRef = useRef(false);

  const log = (label: string, done: number, total: number, line?: string) =>
    setJob((j) => ({ label, done, total, log: line ? [line, ...(j?.log ?? [])].slice(0, 60) : j?.log ?? [] }));

  async function onFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const hash = await sha256(buf);
      const d = JSON.parse(new TextDecoder().decode(buf));
      const props = d.properties ?? [], sources = d.sources ?? [];
      const ids = new Set(props.map((p: { address_id: string }) => p.address_id));
      const docs = new Set(sources.map((s: { doc_id: string }) => s.doc_id));
      if (!String(d.format_version ?? "").startsWith("housing-law-bootstrap/")) throw new Error("Unknown format_version");
      if (ids.size !== props.length || docs.size !== sources.length) throw new Error("Duplicate IDs in file");
      const captured = sources.filter((s: { supplied_text_available: boolean; text: string | null }) => s.supplied_text_available && s.text).length;
      if(props.length!==500 || sources.length!==87 || captured<54) throw new Error("Expected 500 properties, 87 sources and at least the 54 baseline texts (a supplemental version may add more)");
      const expected = { properties: 500 as const, sources: 87 as const, captured };
      const linkOnly = new Map((d.links_only_rows ?? []).map((r: any) => [r.doc_id, r]));
      log("Starting import", 0, 3, `File SHA256 ${hash.slice(0, 16)}… · ${props.length} properties · ${sources.length} sources · ${captured} texts`);
      const start = await fStart({ data: { upload_sha256: hash, format_version: d.format_version, package_metadata: d.package_metadata ?? {}, known_gaps: d.known_gaps ?? [], change_tests: d.change_tests ?? [], rule_record_schema: d.rule_record_schema ?? {}, counts: expected } });
      if (start.alreadyActive) { log("Already imported", 3, 3, "Identical package already active — idempotent, nothing changed."); return; }
      const strip = (p: any) => ({ address_id: p.address_id, street_address: p.street_address, postal_city: p.postal_city ?? null, state: p.state, zip: p.zip ?? null, year_built: p.year_built ?? null, units: p.units ?? null, use_code: p.use_code ?? null, use_description: p.use_description ?? null, source_dataset: p.source_dataset ?? null, retrieved_at: p.retrieved_at ?? null, original_csv_row: p.original_csv_row ?? {} });
      for (let i = 0; i < props.length; i += 250) await fProps({ data: { datasetId: start.datasetId, rows: props.slice(i, i + 250).map(strip) as never } });
      log("Properties stored", 1, 3, `${props.length} properties stored`);
      for (let i = 0; i < sources.length; i += 6) {
        const batch = sources.slice(i, i + 6).map((s: any) => ({ doc_id: s.doc_id, manifest_row: s.manifest_row, supplied_text_available: !!s.supplied_text_available, text: s.text ?? null, local_text_sha256: s.local_text_sha256 ?? null, manifest_hash_matches_local: s.manifest_hash_matches_local ?? null, link_only_row: linkOnly.get(s.doc_id as string) ?? null }));
        await fSrc({ data: { datasetId: start.datasetId, rows: batch as never } });
        log("Storing sources", 1 + (i + 6) / sources.length, 3);
      }
      const receipt = await fFinish({ data: { datasetId: start.datasetId, expected } });
      log("Import complete", 3, 3, `Receipt: ${receipt.properties} properties, ${receipt.sources} sources, ${receipt.captured_texts} captured, ${receipt.link_only_or_missing} link-only/missing.`);
      toast.success("Dataset imported");
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); log("Import failed", 0, 1, (e as Error).message); }
  }

  async function bulkExtract() {
    setStop(false); stopRef.current = false;
    const todo = (await fPlan()).filter(s=>s.chunks.length>0);
    const parts = todo.reduce((n, s) => n + s.chunks.length, 0);
    let ok = 0, failed = 0, halted = "";
    for (const s of todo) {
      if (stopRef.current) { halted = "stopped by you"; break; }
      for (const chunk of s.chunks) {
        if (stopRef.current) { halted = "stopped by you"; break; }
        try {
          const r = await fExtract({ data: { sourceId: s.id, chunkIndex: chunk } });
          ok++; log("Extracting", ok + failed, parts, `${s.doc_id} part ${r.chunkIndex + 1}/${r.chunkCount}: ${r.valid} valid, ${r.invalid} invalid`);
        } catch (e) {
          failed++; const m = (e as Error).message;
          log("Extracting", ok + failed, parts, `${s.doc_id} part ${chunk + 1}: FAILED — ${m}`);
          if (/credits|rate limit|402|429/i.test(m)) { halted = `halted: ${m}`; break; }
        }
      }
      if (halted) break;
    }
    const remaining = parts - ok;
    log(remaining === 0 ? `Extraction complete: ${ok} parts done` : `Extraction incomplete: ${ok} done, ${failed} failed, ${remaining} still pending${halted ? ` (${halted})` : ""} — run again to resume`, ok, Math.max(parts, 1));
    qc.invalidateQueries();
  }

  async function bulkGeocode() {
    stopRef.current = false;
    const { data: props } = await supabase.from("properties").select("id,dataset_versions!inner(status)").eq("dataset_versions.status", "active").limit(2000);
    const { data: res } = await supabase.from("jurisdiction_resolutions").select("property_id").eq("is_current", true).eq("status", "resolved").limit(5000);
    const have = new Set((res ?? []).map((r) => r.property_id));
    const todo = (props ?? []).filter((p) => !have.has(p.id)).map((p) => p.id);
    let processed = 0, resolved = 0, errors = 0, halted = "";
    for (let i = 0; i < todo.length; i += 10) {
      if (stopRef.current) { halted = "stopped by you"; break; }
      const batch = todo.slice(i, i + 10);
      try {
        const out = await fGeo({ data: { propertyIds: batch } });
        processed += batch.length; resolved += out.filter((o) => o.status === "resolved").length;
        const c = out.reduce((a: Record<string, number>, o) => ({ ...a, [o.status as string]: (a[o.status as string] ?? 0) + 1 }), {});
        log("Resolving jurisdictions", processed, todo.length, `Batch ${i / 10 + 1}: ${JSON.stringify(c)}`);
      } catch (e) { errors += batch.length; log("Resolving jurisdictions", processed, todo.length, `Batch ${i / 10 + 1} FAILED: ${(e as Error).message}`); }
    }
    const unresolved = todo.length - resolved;
    log(unresolved === 0 ? `All ${todo.length} addresses placed` : `Placement incomplete: ${resolved} placed, ${processed - resolved} not matched, ${errors} errored${halted ? `, ${halted}` : ""} — run again to retry the rest`, processed, Math.max(todo.length, 1));
    qc.invalidateQueries();
  }

  if (!ready) return <p>Loading…</p>;
  if (!session) return <div className="paper rounded-sm p-6"><p>Admin tools require sign-in.</p><Link to="/auth" className="underline">Sign in</Link></div>;
  const c = overview.data?.counts;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · jobs" title="Import, extract, resolve, export">
        Jobs run while this tab stays open, in bounded steps (one document part or ten addresses per call). Completed parts are persisted; reopening this page lets you resume unfinished parts. AI extraction uses workspace credits.
      </PageHeader>
      <Disclaimer />
      {overview.error && <p role="alert" className="text-st-conflict">{overview.error.message}</p>}
      {c && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Properties" value={c.properties} /><Stat label="Sources / texts" value={`${c.sources} / ${c.captured}`} />
        <Stat label="Current rules" value={c.rules} hint={`${c.invalid} invalid`} /><Stat label="Resolved" value={`${c.resolved}/${c.geocoded}`} hint="resolved / attempted" />
      </div>}

      <section className="paper space-y-3 rounded-sm p-5">
        <h2 className="text-2xl">1 · Import dataset</h2>
        <p className="text-sm text-muted-foreground">Upload <span className="font-mono">housing_law_bootstrap.json</span>. Validates format, duplicate IDs and counts; re-importing the identical file is a no-op; a changed file creates a new dataset version.</p>
        {isAdmin ? <div className="space-y-2"><Button disabled={busy} onClick={()=>runJob(async()=>{try { const r=await fetch("/data/housing_law_bootstrap.json"); if(!r.ok) throw new Error("Bundled dataset unavailable"); await onFile(new File([await r.blob()],"housing_law_bootstrap.json",{type:"application/json"})); }catch(e){toast.error((e as Error).message)}})}>Import supplied hackathon dataset</Button><input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && runJob(()=>onFile(e.target.files![0]!))} className="text-sm" /></div> : <p className="text-sm text-st-unknown">Admin role required.</p>}
        {overview.data?.dataset && <pre className="source-text max-h-48 overflow-auto bg-muted p-2">{JSON.stringify(overview.data.dataset.receipt, null, 2)}</pre>}
      </section>

      <section className="paper space-y-3 rounded-sm p-5">
        <h2 className="text-2xl">2 · Automated extraction</h2>
        <p className="text-sm text-muted-foreground">Runs the AI extractor over every captured text not yet processed. Each candidate must pass schema validation and exact quote matching against the stored text. Uses AI credits.</p>
        <div className="flex gap-2">
          <Button disabled={!isStaff || busy} onClick={()=>runJob(bulkExtract)}>Extract all pending sources</Button>
          <Button variant="outline" onClick={() => { stopRef.current = true; setStop(true); }}>Stop after current step</Button>
        </div>
      </section>

      <section className="paper space-y-3 rounded-sm p-5">
        <h2 className="text-2xl">3 · Jurisdiction resolution</h2>
        <p className="text-sm text-muted-foreground">Queries the public US Census geocoder with street, state and ZIP (not the postal city) and records the incorporated place, county and coordinates with full evidence. No-match and ambiguous results stay unresolved.</p>
        <Button disabled={!isStaff || busy} onClick={()=>runJob(bulkGeocode)}>Resolve unresolved addresses</Button>
      </section>

      {job && (
        <section className="paper space-y-2 rounded-sm p-5">
          <div className="eyebrow">{job.label}{stop && " · stopping"}</div>
          <Progress value={(job.done / Math.max(1, job.total)) * 100} />
          <div className="source-text max-h-60 overflow-auto">{job.log.join("\n")}</div>
        </section>
      )}

      <section className="paper space-y-3 rounded-sm p-5">
        <h2 className="text-2xl">4 · Submission exports</h2>
        <p className="text-sm text-muted-foreground">Organizer-shaped files generated from the same engine. No judge score is computed — no scoring script or answer key was supplied.</p>
        <div className="flex flex-wrap gap-2">
          {(["rules", "lookups", "changes"] as const).map((k) => (
            <Button disabled={!isStaff || busy} key={k} variant="outline" onClick={async () => { try { const result=await fExport({ data: { kind: k, diagnostic: false } }); download(`${k}.json`,result.artifact); download(`${k}-receipt.json`,result.receipt); } catch (e) { toast.error((e as Error).message); } }}>{k}.json</Button>
          ))}
        </div>
        <Button disabled={!isStaff || busy} variant="outline" onClick={async()=>{try { for(const kind of ["rules","lookups","changes"] as const) {const result=await fExport({data:{kind,diagnostic:true}}); download(`diagnostic-${kind}.json`,result.artifact); download(`diagnostic-${kind}-receipt.json`,result.receipt);} }catch(e){toast.error((e as Error).message)}}}>Download diagnostic exports (not a verified submission)</Button>
      </section>
    </div>
  );
}
