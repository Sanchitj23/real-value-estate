import { MissingSources } from "@/components/app/MissingSources";
import { requireStaffPage } from "@/lib/staff-guard";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { CheckCircle2, Circle, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { importStart, importProperties, importSources, importFinish, extractSource, geocodeBatch, getExtractionPlan, finishSource, autoLinkCases } from "@/lib/admin.functions";
import { exportSubmission, getOverview } from "@/lib/engine.functions";
import { Disclaimer, PageHeader, download } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: () => requireStaffPage(false),
  head: () => ({
    meta: [
      { title: "Data & jobs — Housing Law Navigator" },
      { name: "description", content: "Import the dataset, read the legal texts, place the addresses, link the test cases and export submission files." },
      { property: "og:title", content: "Data & jobs — Housing Law Navigator" },
      { property: "og:description", content: "Dataset import, reading, address placement and exports." },
    ],
  }),
  component: Admin,
});

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type StepState = "done" | "partial" | "todo";
const StepIcon = ({ s }: { s: StepState }) => s === "done" ? <CheckCircle2 className="h-5 w-5 text-st-applies" /> : s === "partial" ? <CircleDashed className="h-5 w-5 text-st-unknown" /> : <Circle className="h-5 w-5 text-muted-foreground" />;

function Admin() {
  const { session, isAdmin, isStaff, ready } = useAuth();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => getOverview(), throwOnError: false });
  const fStart = useServerFn(importStart), fProps = useServerFn(importProperties), fSrc = useServerFn(importSources), fFinish = useServerFn(importFinish);
  const fPlan = useServerFn(getExtractionPlan), fDone = useServerFn(finishSource), fLink = useServerFn(autoLinkCases);
  const fExtract = useServerFn(extractSource), fGeo = useServerFn(geocodeBatch), fExport = useServerFn(exportSubmission);
  const plan = useQuery({ enabled: isStaff, queryKey: ["extraction-plan"], queryFn: () => fPlan(), throwOnError: false });
  const cases = useQuery({
    enabled: isStaff, queryKey: ["case-links"], throwOnError: false,
    queryFn: async () => {
      const ds = await supabase.from("dataset_versions").select("change_tests").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (ds.error) throw new Error(ds.error.message);
      const ids = Array.from(new Set(((ds.data?.change_tests ?? []) as any[]).flatMap((t) => (t.rule_ids ?? []) as string[])));
      const maps = await supabase.from("semantic_mappings").select("challenge_rule_id,rule_key");
      if (maps.error) throw new Error(maps.error.message);
      return { ids, linked: ids.filter((id) => (maps.data ?? []).some((m) => m.challenge_rule_id === id && m.rule_key)) };
    },
  });
  const [busy, setBusy] = useState(false);
  const runJob = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const [job, setJob] = useState<{ label: string; done: number; total: number; log: string[] } | null>(null);
  const [stop, setStop] = useState(false);
  const stopRef = useRef(false);

  const log = (label: string, done: number, total: number, line?: string) =>
    setJob((j) => ({ label, done, total, log: line ? [line, ...(j?.log ?? [])].slice(0, 80) : j?.log ?? [] }));

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
      if (props.length !== 500 || sources.length !== 87 || captured < 54) throw new Error("Expected 500 properties, 87 sources and at least the 54 baseline texts (a supplemental version may add more)");
      const expected = { properties: 500 as const, sources: 87 as const, captured };
      const linkOnly = new Map((d.links_only_rows ?? []).map((r: any) => [r.doc_id, r]));
      log("Starting import", 0, 3, `File SHA256 ${hash.slice(0, 16)}… · ${props.length} properties · ${sources.length} sources · ${captured} texts`);
      const start = await fStart({ data: { upload_sha256: hash, format_version: d.format_version, package_metadata: d.package_metadata ?? {}, known_gaps: d.known_gaps ?? [], change_tests: d.change_tests ?? [], rule_record_schema: d.rule_record_schema ?? {}, counts: expected } });
      if (start.alreadyActive) { log("Already imported", 3, 3, "This exact package is already active. Nothing changed."); return; }
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

  /** Reads every part that hasn't been read with the current instructions, then retires rules an older reading left behind. */
  async function bulkExtract(): Promise<boolean> {
    setStop(false); stopRef.current = false;
    const all = await fPlan();
    const todo = all.filter((s) => s.chunks.length > 0);
    const parts = todo.reduce((n, s) => n + s.chunks.length, 0);
    let ok = 0, failed = 0, halted = "";
    const finished = new Set(all.filter((s) => s.chunks.length === 0).map((s) => s.id));
    if (parts === 0) log("Reading legal texts", 1, 1, "Every part has already been read with the current instructions.");
    for (const s of todo) {
      if (stopRef.current) { halted = "stopped by you"; break; }
      let sourceOk = true;
      for (const chunk of s.chunks) {
        if (stopRef.current) { halted = "stopped by you"; sourceOk = false; break; }
        try {
          const r = await fExtract({ data: { sourceId: s.id, chunkIndex: chunk } });
          ok++; log("Reading legal texts", ok + failed, parts, `${s.doc_id} part ${r.chunkIndex + 1}/${r.chunkCount}: ${r.valid} rules kept, ${r.invalid} rejected`);
        } catch (e) {
          failed++; sourceOk = false; const m = (e as Error).message;
          log("Reading legal texts", ok + failed, parts, `${s.doc_id} part ${chunk + 1}: FAILED — ${m}`);
          if (/credits|rate limit|402|429/i.test(m)) { halted = `halted: ${m}`; break; }
        }
      }
      if (sourceOk) finished.add(s.id);
      if (halted) break;
    }
    let retired = 0, tidied = 0;
    for (const id of finished) {
      if (stopRef.current) break;
      try { const r = await fDone({ data: { sourceId: id } }); retired += r.retired; } catch (e) { log("Tidying up", tidied, finished.size, `Could not tidy a source: ${(e as Error).message}`); }
      tidied++;
      if (tidied % 6 === 0 || tidied === finished.size) log("Tidying up older rules", tidied, finished.size);
    }
    const remaining = parts - ok;
    log(remaining === 0 ? `Reading complete: ${ok} parts read${retired ? `, ${retired} older rules replaced` : ""}` : `Reading incomplete: ${ok} read, ${failed} failed, ${remaining} still to read${halted ? ` (${halted})` : ""} — run again to continue`, ok, Math.max(parts, 1));
    qc.invalidateQueries();
    return remaining === 0;
  }

  async function bulkGeocode(): Promise<void> {
    stopRef.current = false; setStop(false);
    const { data: props, error: pe } = await supabase.from("properties").select("id,dataset_versions!inner(status)").eq("dataset_versions.status", "active").limit(2000);
    const { data: res, error: re } = await supabase.from("jurisdiction_resolutions").select("property_id").eq("is_current", true).eq("status", "resolved").limit(5000);
    if (pe || re) throw new Error(`Couldn't list addresses: ${(pe ?? re)!.message}`);
    const have = new Set((res ?? []).map((r) => r.property_id));
    const todo = (props ?? []).filter((p) => !have.has(p.id)).map((p) => p.id);
    if (!todo.length) { log("Placing addresses", 1, 1, "Every address already has a confirmed legal city."); return; }
    let processed = 0, resolved = 0, errors = 0, halted = "";
    for (let i = 0; i < todo.length; i += 10) {
      if (stopRef.current) { halted = "stopped by you"; break; }
      const batch = todo.slice(i, i + 10);
      try {
        const out = await fGeo({ data: { propertyIds: batch } });
        processed += batch.length; resolved += out.filter((o) => o.status === "resolved").length;
        const c = out.reduce((a: Record<string, number>, o) => ({ ...a, [o.status as string]: (a[o.status as string] ?? 0) + 1 }), {});
        log("Placing addresses", processed, todo.length, `Batch ${i / 10 + 1}: ${Object.entries(c).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ")}`);
      } catch (e) { errors += batch.length; log("Placing addresses", processed, todo.length, `Batch ${i / 10 + 1} FAILED: ${(e as Error).message}`); }
    }
    log(resolved === todo.length ? `All ${todo.length} addresses placed` : `Placement finished: ${resolved} placed, ${processed - resolved} not matched or ambiguous, ${errors} errored${halted ? `, ${halted}` : ""}`, processed, Math.max(todo.length, 1));
    qc.invalidateQueries();
  }

  async function linkCases(): Promise<void> {
    const r = await fLink();
    for (const l of r.links) log("Linking test cases", 1, 1, `${l.challenge_id}: ${l.rule_key ? `${l.saved ? "linked to" : "stays on"} ${l.rule_key}` : "not linked"} — ${l.reason}`);
    log(`Test cases: ${r.links.filter((l) => l.rule_key).length} of ${r.links.length} IDs linked${r.relations ? `, ${r.relations} possible state-over-city conflicts flagged` : ""}`, 1, 1);
    qc.invalidateQueries();
  }

  async function prepareAll(): Promise<void> {
    const complete = await bulkExtract();
    if (stopRef.current) return;
    await bulkGeocode();
    if (stopRef.current) return;
    await linkCases();
    toast[complete ? "success" : "warning"](complete ? "Everything that can run has run." : "Finished, but some legal texts still need reading. Run again to continue.");
  }

  if (!ready) return <p>Loading…</p>;
  if (!session) return <div className="paper rounded-sm p-6"><p>Admin tools require sign-in.</p><Link to="/auth" className="underline">Sign in</Link></div>;
  const c = overview.data?.counts;
  const partsTotal = (plan.data ?? []).reduce((n, s) => n + s.total, 0), partsLeft = (plan.data ?? []).reduce((n, s) => n + s.chunks.length, 0);
  const steps: Array<{ label: string; state: StepState; detail: string }> = [
    { label: "Dataset imported", state: c && c.properties > 0 ? "done" : "todo", detail: c ? `${c.properties} addresses, ${c.sources} references, ${c.captured} with text (${c.sources - c.captured} have no text)` : "No active dataset yet" },
    { label: "Legal texts read", state: !plan.data || !partsTotal ? "todo" : partsLeft === 0 ? "done" : partsLeft < partsTotal ? "partial" : "todo", detail: plan.data ? `${partsTotal - partsLeft} of ${partsTotal} parts read with the current instructions · ${c?.rules ?? 0} rules in use` : plan.error ? `Couldn't load: ${plan.error.message}` : "Checking…" },
    { label: "Addresses placed in their legal city", state: !c || !c.properties ? "todo" : c.resolved >= c.properties ? "done" : c.resolved > 0 ? "partial" : "todo", detail: c ? `${c.resolved} of ${c.properties} placed${c.geocoded > c.resolved ? ` · ${c.geocoded - c.resolved} tried without a clear match` : ""}` : "—" },
    { label: "Test cases linked to rules", state: !cases.data?.ids.length ? "todo" : cases.data.linked.length === cases.data.ids.length ? "done" : cases.data.linked.length ? "partial" : "todo", detail: cases.data ? `${cases.data.linked.length} of ${cases.data.ids.length} challenge rule IDs linked` : "Checking…" },
    { label: "Rules checked by a person (optional)", state: c && c.reviewed > 0 ? (c.reviewed >= c.rules ? "done" : "partial") : "todo", detail: c ? `${c.reviewed} of ${c.rules} reviewed` : "—" },
  ];
  const allDone = steps.slice(0, 4).every((s) => s.state === "done");

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Staff" title="Data & jobs">
        Everything the answers are built from. One button runs whatever is still missing. Jobs run in this browser tab in small steps, so keep it open; finished steps are saved and a second run continues where the first stopped.
      </PageHeader>
      {overview.error && <p role="alert" className="text-st-conflict">Couldn't load the status: {overview.error.message}</p>}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl text-ink">Status</h2>
          <span className={allDone ? "text-sm font-medium text-st-applies" : "text-sm font-medium text-st-unknown"}>{allDone ? "Ready" : "Not complete yet"}</span>
        </div>
        <ol className="mt-3 space-y-2.5">
          {steps.map((s) => <li key={s.label} className="flex items-start gap-3"><StepIcon s={s.state} /><span className="text-sm"><span className="font-medium">{s.label}</span><span className="block text-muted-foreground">{s.detail}</span></span></li>)}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button disabled={!isStaff || busy || !c?.properties} onClick={() => runJob(prepareAll)}>Run everything that's left</Button>
          <Button variant="outline" disabled={!busy} onClick={() => { stopRef.current = true; setStop(true); }}>Stop after the current step</Button>
          <span className="text-xs text-muted-foreground">{partsLeft > 0 ? `Reading ${partsLeft} parts uses workspace AI credits (low-cost model).` : "Nothing left to read, so no AI credits are needed."}</span>
        </div>
      </section>

      {job && (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-2 text-sm font-medium">{job.label}{stop && " · stopping"}</div>
          <Progress value={(job.done / Math.max(1, job.total)) * 100} />
          <div className="source-text mt-3 max-h-60 overflow-auto">{job.log.join("\n")}</div>
        </section>
      )}

      <details className="rounded-lg border border-border bg-card p-5">
        <summary className="cursor-pointer font-medium">Run one step at a time</summary>
        <div className="mt-4 space-y-5 text-sm">
          <div>
            <div className="font-medium">1 · Import the dataset</div>
            <p className="mt-1 text-muted-foreground">Loads the bundled hackathon package. Importing the same file again does nothing; a changed file becomes a new dataset version and the old one is kept.</p>
            {isAdmin ? <div className="mt-2 flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy} onClick={() => runJob(async () => { const r = await fetch("/data/housing_law_bootstrap.json"); if (!r.ok) throw new Error("Bundled dataset unavailable"); await onFile(new File([await r.blob()], "housing_law_bootstrap.json", { type: "application/json" })); })}>Import the bundled dataset</Button><input type="file" accept="application/json" aria-label="Import another package file" onChange={(e) => e.target.files?.[0] && runJob(() => onFile(e.target.files![0]!))} className="text-sm" /></div> : <p className="mt-2 text-st-unknown">Importing needs the admin role.</p>}
          </div>
          <div>
            <div className="font-medium">2 · Read the legal texts</div>
            <p className="mt-1 text-muted-foreground">An AI reader turns each text into rules. Every rule must quote the text exactly or it is rejected. Uses AI credits.</p>
            <Button variant="outline" className="mt-2" disabled={!isStaff || busy} onClick={() => runJob(async () => { await bulkExtract(); })}>Read the remaining texts</Button>
          </div>
          <div>
            <div className="font-medium">3 · Place the addresses</div>
            <p className="mt-1 text-muted-foreground">Asks the US Census geocoder which city each address is legally in. The mailing city is only used to find the street; the answer comes from the Census boundary.</p>
            <Button variant="outline" className="mt-2" disabled={!isStaff || busy} onClick={() => runJob(bulkGeocode)}>Place the remaining addresses</Button>
          </div>
          <div>
            <div className="font-medium">4 · Link the test cases</div>
            <p className="mt-1 text-muted-foreground">Connects each challenge rule ID (T1–T5) to the rule it names, by jurisdiction, topic and bill number. Links you set by hand are left alone.</p>
            <Button variant="outline" className="mt-2" disabled={!isStaff || busy} onClick={() => runJob(linkCases)}>Link unlinked IDs</Button>
          </div>
        </div>
      </details>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-serif text-2xl text-ink">Submission files</h2>
        <p className="mt-1 text-sm text-muted-foreground">Made by the same engine as every report. rules.json and lookups.json need every text to be read; changes.json also needs each T1–T5 check to pass. The preview files have no such gates and are labelled as previews. No judge score is computed.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["rules", "lookups", "changes"] as const).map((k) => (
            <Button disabled={!isStaff || busy} key={k} variant="outline" onClick={async () => { try { const result = await fExport({ data: { kind: k, diagnostic: false } }); download(`${k}.json`, result.artifact); download(`${k}-receipt.json`, result.receipt); } catch (e) { toast.error((e as Error).message); } }}>{k}.json</Button>
          ))}
          <Button disabled={!isStaff || busy} variant="ghost" onClick={async () => { try { for (const kind of ["rules", "lookups", "changes"] as const) { const result = await fExport({ data: { kind, diagnostic: true } }); download(`preview-${kind}.json`, result.artifact); download(`preview-${kind}-receipt.json`, result.receipt); } } catch (e) { toast.error((e as Error).message); } }}>Download preview files</Button>
        </div>
        {overview.data?.dataset && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Import receipt</summary><pre className="source-text mt-2 max-h-48 overflow-auto rounded-sm bg-muted p-2">{JSON.stringify(overview.data.dataset.receipt, null, 2)}</pre></details>}
      </section>
      <MissingSources />
      <Disclaimer />
    </div>
  );
}
