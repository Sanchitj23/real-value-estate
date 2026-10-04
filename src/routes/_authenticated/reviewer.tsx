import { getData } from "@/lib/db-result";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Status } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/reviewer")({
  head: () => ({
    meta: [
      { title: "Legal & policy reviewer — Housing Law Navigator" },
      { name: "description", content: "Review automatically extracted rules against exact source quotes, record interactions and inspect the supplied corpus." },
      { property: "og:title", content: "Legal & policy reviewer — Housing Law Navigator" },
      { property: "og:description", content: "Source text, extracted rules, review queue and interactions." },
    ],
  }),
  component: Reviewer,
});

function Reviewer() {
  const { isStaff } = useAuth();
  const rules = useQuery({
    queryKey: ["rules-current"],
    queryFn: async () => getData(await supabase.from("rule_versions").select("id,rule_key,version,jurisdiction,category,title,legal_status,effective_date,review_state,validation_errors,confidence,source_documents!inner(doc_id,dataset_versions!inner(status))").eq("source_documents.dataset_versions.status","active").or("is_current.eq.true,review_state.eq.invalid").order("rule_key")) ?? [],
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: async () => getData(await supabase.from("source_documents").select("id,doc_id,jurisdictions,source_type,capture,text_available,retrieved_at,hash_matches,dataset_versions!inner(status)").eq("dataset_versions.status", "active").order("doc_id")) ?? [],
  });
  const runs = useQuery({ enabled:isStaff, queryKey: ["run-counts"], queryFn: async () => getData(await supabase.from("extraction_runs").select("source_id,status,valid,invalid").order("created_at", { ascending: false }).limit(1000)) ?? [] });
  const relations = useQuery({ queryKey: ["relations"], queryFn: async () => getData(await supabase.from("rule_relations").select("*").order("created_at", { ascending: false })) ?? [] });
  const [f, setF] = useState({ q: "", state: "all", cat: "all" });

  const filtered = useMemo(() => (rules.data ?? []).filter((r) =>
    (f.state === "all" || r.review_state === f.state) && (f.cat === "all" || r.category === f.cat) &&
    (!f.q || `${r.title} ${r.jurisdiction} ${r.rule_key}`.toLowerCase().includes(f.q.toLowerCase()))), [rules.data, f]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace III · Legal / policy reviewer" title="Evidence and interpretation review">
        Every extracted rule carries an exact quote checked against the stored source text. A valid quote is necessary but does not prove the interpretation is correct. Edits create a new version with a reason and audit entry.
      </PageHeader>
      <Disclaimer />
      {!isStaff && <p className="text-sm text-muted-foreground">Read-only view. <Link to="/auth" className="underline">Sign in</Link> as a reviewer to edit, map and extract.</p>}
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules ({rules.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="sources">Sources ({sources.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="relations">Interactions ({relations.data?.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Filter…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="max-w-xs" />
            <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
              {["all", "validated_auto", "reviewed", "invalid"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
              <option value="all">all categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="paper overflow-x-auto rounded-sm">
            <table className="w-full text-sm">
              <thead className="eyebrow border-b border-border text-left"><tr><th className="p-2">Rule</th><th className="p-2">Jurisdiction</th><th className="p-2">Category</th><th className="p-2">Legal status</th><th className="p-2">Effective</th><th className="p-2">Review</th><th className="p-2">Conf.</th></tr></thead>
              <tbody>{filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="p-2"><Link to="/rules/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.title}</Link><div className="font-mono text-[0.68rem] text-muted-foreground">{r.rule_key} · v{r.version}</div></td>
                  <td className="p-2">{r.jurisdiction}</td>
                  <td className="p-2 text-xs">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                  <td className="p-2"><Status value={r.legal_status} /></td>
                  <td className="p-2 font-mono text-xs">{r.effective_date ?? "—"}</td>
                  <td className="p-2"><Status value={r.review_state} /></td>
                  <td className="p-2 font-mono text-xs">{r.confidence ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
            {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No rules yet. Open a source and run extraction, or use bulk extraction in Admin.</p>}
          </div>
        </TabsContent>
        <TabsContent value="sources">
          <div className="paper overflow-x-auto rounded-sm">
            <table className="w-full text-sm">
              <thead className="eyebrow border-b border-border text-left"><tr><th className="p-2">Doc</th><th className="p-2">Jurisdiction</th><th className="p-2">Type</th><th className="p-2">Text</th><th className="p-2">Retrieved</th><th className="p-2">Extraction</th></tr></thead>
              <tbody>{(sources.data ?? []).map((s) => {
                const rs = (runs.data ?? []).filter((r) => r.source_id === s.id);
                return (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="p-2"><Link to="/sources/$docId" params={{ docId: s.doc_id }} className="font-mono text-primary hover:underline">{s.doc_id}</Link></td>
                    <td className="p-2">{s.jurisdictions}</td>
                    <td className="p-2 text-xs text-muted-foreground">{s.source_type}</td>
                    <td className="p-2">{s.text_available ? <Status value="in_force" className="!normal-case" /> : <Status value="none" />}<span className="ml-1 text-xs">{s.text_available ? "captured" : "link only / missing"}</span></td>
                    <td className="p-2 font-mono text-xs">{s.retrieved_at}</td>
                    <td className="p-2 text-xs">{rs.length ? `${rs.length} runs · ${rs.reduce((a, r) => a + r.valid, 0)} valid / ${rs.reduce((a, r) => a + r.invalid, 0)} invalid` : "not run"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="relations">
          <div className="paper rounded-sm p-4 text-sm">
            <p className="mb-3 text-muted-foreground">Only documented, category-specific interactions are applied. Add them from a rule's page.</p>
            {(relations.data ?? []).map((r) => (
              <div key={r.id} className="border-b border-border/60 py-2"><span className="font-mono text-xs">{r.from_rule_key}</span> <Status value={r.relation_type.includes("conflict") || r.relation_type.includes("preemption") ? "conflict" : "superseded"} /> {r.relation_type} <span className="font-mono text-xs">{r.to_rule_key}</span><div className="text-xs text-muted-foreground">{r.note}</div></div>
            ))}
            {!relations.data?.length && <p className="text-muted-foreground">No interactions recorded.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
