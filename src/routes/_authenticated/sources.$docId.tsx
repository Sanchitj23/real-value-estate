import { getData } from "@/lib/db-result";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractSource } from "@/lib/admin.functions";
import { Disclaimer, PageHeader, Status } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/sources/$docId")({
  head: ({ params }) => ({
    meta: [
      { title: `Source ${params.docId} — Housing Law Navigator` },
      { name: "description", content: `Supplied legal text and extraction evidence for corpus document ${params.docId}.` },
      { property: "og:title", content: `Source ${params.docId} — Housing Law Navigator` },
      { property: "og:description", content: "Captured legal source text with highlighted quoted evidence." },
    ],
  }),
  component: SourcePage,
});

function SourcePage() {
  const { docId } = Route.useParams();
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const extract = useServerFn(extractSource);
  const [busy, setBusy] = useState<string | null>(null);

  const src = useQuery({
    queryKey: ["source", docId],
    queryFn: async () => getData(await supabase.from("source_documents").select("*, dataset_versions!inner(status)").eq("doc_id", docId).eq("dataset_versions.status", "active").maybeSingle()),
  });
  const rules = useQuery({
    enabled: !!src.data,
    queryKey: ["source-rules", src.data?.id],
    queryFn: async () => getData(await supabase.from("rule_versions").select("id,title,category,review_state,version,rule_evidence(start_offset,end_offset,valid,field)").eq("source_id", src.data!.id).eq("is_current", true)) ?? [],
  });
  const runs = useQuery({
    enabled: !!src.data && isStaff,
    queryKey: ["source-runs", src.data?.id],
    queryFn: async () => getData(await supabase.from("extraction_runs").select("*").eq("source_id", src.data!.id).order("created_at", { ascending: false })) ?? [],
  });

  async function run(force = false) {
    if (!src.data) return;
    let chunk = 0;
    try {
      for (;;) {
        setBusy(`Extracting part ${chunk + 1}…`);
        const r = await extract({ data: { sourceId: src.data.id, chunkIndex: chunk, force } });
        toast.success(`Part ${r.chunkIndex + 1}/${r.chunkCount}: ${r.valid} valid, ${r.invalid} invalid`);
        if (r.done) break;
        chunk++;
      }
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
    qc.invalidateQueries();
  }

  if (src.isLoading) return <p>Loading…</p>;
  const s = src.data;
  if (!s) return <p>Source not found in the active dataset.</p>;

  const ranges = (rules.data ?? []).flatMap((r) => r.rule_evidence.filter((e) => e.valid && e.start_offset != null).map((e) => ({ s: e.start_offset!, e: e.end_offset!, id: r.id })));
  ranges.sort((a, b) => a.s - b.s);
  const parts: ReactNode[] = [];
  let pos = 0;
  if (s.text) {
    for (const r of ranges) {
      if (r.s < pos) continue;
      parts.push(s.text.slice(pos, r.s));
      parts.push(<mark key={`${r.s}-${r.id}`} className="bg-st-applies-bg text-st-applies">{s.text.slice(r.s, r.e)}</mark>);
      pos = r.e;
    }
    parts.push(s.text.slice(pos));
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Corpus document · ${s.doc_id}`} title={s.jurisdictions ?? s.doc_id}>
        <a href={s.url ?? "#"} target="_blank" rel="noreferrer" className="break-all underline">{s.url}</a>
      </PageHeader>
      <Disclaimer />
      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <div className="paper max-h-[75vh] overflow-auto rounded-sm p-5">
          {s.text ? <div className="source-text">{parts}</div> : (
            <div className="text-sm text-muted-foreground">
              <p><strong>No captured text was supplied for this reference.</strong> Missing source text is not proof that a law is absent; it is a source dependency.</p>
              {s.link_only_row && <pre className="mt-3 source-text">{JSON.stringify(s.link_only_row, null, 2)}</pre>}
            </div>
          )}
        </div>
        <aside className="space-y-4 text-sm">
          <div className="paper rounded-sm p-4">
            <div className="eyebrow mb-2">Provenance</div>
            <dl className="space-y-1 text-xs">
              <div>Type: {s.source_type}</div>
              <div>Retrieved: <span className="font-mono">{s.retrieved_at}</span></div>
              <div className="break-all">Manifest SHA256: <span className="font-mono">{s.manifest_sha256 ?? "—"}</span></div>
              <div className="break-all">Local text SHA256: <span className="font-mono">{s.local_sha256 ?? "—"}</span></div>
              <div>Hashes match: {s.hash_matches === null ? "n/a" : s.hash_matches ? "yes" : "no — provenance unresolved (not evidence of tampering)"}</div>
              <div>Offsets: JS string indices into the stored decoded text.</div>
            </dl>
          </div>
          {s.text && isStaff && (
            <Button onClick={() => run(false)} disabled={!!busy} className="w-full">{busy ?? (runs.data?.length ? "Resume unfinished parts" : "Run automated extraction")}</Button>
            {!!runs.data?.length && <Button variant="outline" onClick={() => { if (confirm("Re-read every part again? This uses AI credits even for finished parts.")) run(true); }} disabled={!!busy} className="mt-2 w-full">Re-extract all parts (uses credits)</Button>}
          )}
          <div className="paper rounded-sm p-4">
            <div className="eyebrow mb-2">Extracted rules ({rules.data?.length ?? 0})</div>
            {(rules.data ?? []).map((r) => (
              <div key={r.id} className="border-b border-border/60 py-1.5">
                <Link to="/rules/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.title}</Link>
                <div className="mt-0.5 flex gap-1"><Status value={r.review_state} kind="review" /><span className="font-mono text-[0.68rem] text-muted-foreground">v{r.version}</span></div>
              </div>
            ))}
          </div>
          <div className="paper rounded-sm p-4">
            <div className="eyebrow mb-2">Extraction runs</div>
            {(runs.data ?? []).map((r) => (
              <div key={r.id} className="border-b border-border/60 py-1 text-xs">
                <Status value={r.status} kind="job" /> part {r.chunk_index + 1}/{r.chunk_count} · {r.valid} valid / {r.invalid} invalid · <span className="font-mono">{r.model}</span>
                <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString()} {r.error && `— ${r.error}`}</div>
              </div>
            ))}
            {!runs.data?.length && <p className="text-xs text-muted-foreground">Not run yet.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
