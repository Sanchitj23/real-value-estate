import { getData } from "@/lib/db-result";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addRelation, reviseRule, setMapping } from "@/lib/admin.functions";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/engine/applicability";
import { describe, type Expr } from "@/lib/engine/expr";
import { Disclaimer, PageHeader, Status } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/rules/$id")({
  head: () => ({
    meta: [
      { title: "Extracted rule — Housing Law Navigator" },
      { name: "description", content: "An automatically extracted rental-housing rule with exact quoted evidence, version history and review actions." },
      { property: "og:title", content: "Extracted rule — Housing Law Navigator" },
      { property: "og:description", content: "Rule interpretation, evidence and history." },
    ],
  }),
  component: RulePage,
});

const CHALLENGE_IDS = ["CA-ALG-01", "HOB-ALG-01", "JC-ALG-01", "NJ-ALG-01", "MA-ALG-P1", "MA-ALG-P2", "MA-RENT-P1"];
const REL_TYPES = ["replaces", "stricter-local-standard", "explicit-exception", "complementary", "possible-preemption", "unresolved-conflict"] as const;

function RulePage() {
  const { id } = Route.useParams();
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const revise = useServerFn(reviseRule);
  const map = useServerFn(setMapping);
  const relate = useServerFn(addRelation);

  const rule = useQuery({ queryKey: ["rule", id], queryFn: async () => getData(await supabase.from("rule_versions").select("*, rule_evidence(*), source_documents(doc_id)").eq("id", id).single()) });
  const history = useQuery({
    enabled: !!rule.data, queryKey: ["rule-history", rule.data?.rule_key],
    queryFn: async () => getData(await supabase.from("rule_versions").select("id,version,review_state,change_reason,created_at,is_current").eq("rule_key", rule.data!.rule_key).eq("source_id",rule.data!.source_id).order("version", { ascending: false })) ?? [],
  });
  const others = useQuery({ queryKey: ["rule-keys"], queryFn: async () => getData(await supabase.from("rule_versions").select("rule_key,title,jurisdiction,category,source_documents!inner(dataset_versions!inner(status))").eq("source_documents.dataset_versions.status","active").eq("is_current", true).order("rule_key")) ?? [] });
  const mappings = useQuery({ queryKey: ["mappings"], queryFn: async () => getData(await supabase.from("semantic_mappings").select("*")) ?? [] });

  const [form, setForm] = useState({ title: "", requirement: "", key_value: "", legal_status: "unknown", effective_date: "", category: "", coverage: "", exemptions: "", coverage_status:"unknown", exemptions_status:"unknown", supporting_quotes:"[]", reason: "" });
  useEffect(() => {
    const r = rule.data;
    if (r) setForm({ title: r.title, requirement: r.requirement, key_value: r.key_value ?? "", legal_status: r.legal_status, effective_date: r.effective_date ?? "", category: r.category, coverage: r.coverage ? JSON.stringify(r.coverage) : "", exemptions: r.exemptions ? JSON.stringify(r.exemptions) : "", coverage_status:r.coverage_status, exemptions_status:r.exemptions_status, supporting_quotes:"[]", reason: "" });
  }, [rule.data]);
  const [rel, setRel] = useState({ to: "", type: "possible-preemption" as (typeof REL_TYPES)[number], note: "", quote:"" });

  if (rule.isLoading) return <p>Loading…</p>;
  const r = rule.data;
  if (!r) return <p>Rule not found.</p>;
  const docId = (r.source_documents as { doc_id: string } | null)?.doc_id;

  async function save(review_state: "reviewed" | "invalid") {
    try {
      const parse = (s: string) => (s.trim() ? (JSON.parse(s) as Expr) : null);
      const res = await revise({ data: {
        ruleId: r!.id, reason: form.reason, review_state, supporting_quotes:JSON.parse(form.supporting_quotes),
        changes: { title: form.title, requirement: form.requirement, key_value: form.key_value || null, legal_status: form.legal_status as never, effective_date: form.effective_date || null, category: form.category as never, coverage: parse(form.coverage), exemptions: parse(form.exemptions), coverage_status:form.coverage_status as never, exemptions_status:form.exemptions_status as never },
      } });
      toast.success("New interpretation version saved");
      qc.invalidateQueries();
      nav({ to: "/rules/$id", params: { id: res.id } });
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${r.rule_key} · version ${r.version}${r.is_current ? "" : " (superseded version)"}`} title={r.title}>
        {r.jurisdiction} · {CATEGORY_LABEL[r.category]} · {r.citation}
      </PageHeader>
      <div className="flex flex-wrap gap-2"><Status value={r.legal_status} /><Status value={r.review_state} kind="review" />{r.effective_date && <span className="font-mono text-xs">effective {r.effective_date}</span>}</div>
      <Disclaimer extra="Legal lifecycle, applicability and review state are independent labels." />

      <section className="grid gap-4 md:grid-cols-2">
        <div className="paper space-y-3 rounded-sm p-5 text-sm">
          <div><div className="eyebrow">Requirement</div><p className="mt-1">{r.requirement}</p></div>
          {r.key_value && <div><div className="eyebrow">Key value</div><p className="mt-1 font-serif text-xl">{r.key_value}</p></div>}
          <div><div className="eyebrow">Coverage (validated expression)</div><p className="mt-1 font-mono text-xs">{r.coverage ? describe(r.coverage as Expr) : r.coverage_status === "unconditional" ? "Unconditional coverage supported by source" : "Coverage not established — review required"}</p>{r.coverage_text && <p className="mt-1 text-muted-foreground">{r.coverage_text}</p>}</div>
          <div><div className="eyebrow">Exemptions</div><p className="mt-1 font-mono text-xs">{r.exemptions ? describe(r.exemptions as Expr) : r.exemptions_status === "none" ? "No exemptions stated (supported by source)" : "Exemptions not established — review required"}</p>{r.exemptions_text && <p className="mt-1 text-muted-foreground">{r.exemptions_text}</p>}</div>
          {r.interaction_text && <div><div className="eyebrow">Stated interaction</div><p className="mt-1">{r.interaction_text}</p></div>}
          {(r.validation_errors as string[]).length > 0 && <div className="text-st-conflict"><div className="eyebrow">Validation issues</div><ul>{(r.validation_errors as string[]).map((e) => <li key={e}>• {e}</li>)}</ul></div>}
        </div>
        <div className="paper space-y-3 rounded-sm p-5 text-sm">
          <div className="eyebrow">Evidence (checked against stored source text)</div>
          {r.rule_evidence.map((e) => (
            <div key={e.id}>
              <div className="flex items-center gap-2 text-xs"><Status value={e.valid ? "resolved" : "invalid"} /> {e.field} · {e.match_kind}{e.start_offset != null && <span className="font-mono">[{e.start_offset}–{e.end_offset}]</span>}</div>
              <blockquote className="mt-1 border-l-2 border-primary bg-muted/60 px-3 py-2 source-text">“{e.quote}”</blockquote>
            </div>
          ))}
          {docId && <Link to="/sources/$docId" params={{ docId }} className="text-primary underline">Open source {docId}</Link>}
        </div>
      </section>

      <section className="paper rounded-sm p-5 text-sm">
        <div className="eyebrow mb-2">Version history</div>
        {(history.data ?? []).map((h) => (
          <div key={h.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1">
            <Link to="/rules/$id" params={{ id: h.id }} className="font-mono text-primary">v{h.version}</Link>
            <Status value={h.review_state} kind="review" />{h.is_current && <span className="text-xs">current</span>}
            <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()} — {h.change_reason ?? "automated extraction"}</span>
          </div>
        ))}
      </section>

      {isStaff && (r.is_current || r.review_state === "invalid") && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="paper space-y-2 rounded-sm p-5 text-sm">
            <h2 className="text-xl">Review / revise interpretation</h2>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Key value" value={form.key_value} onChange={(e) => setForm({ ...form, key_value: e.target.value })} />
              <Input placeholder="Effective YYYY-MM-DD" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
              <select className="h-9 rounded-sm border border-input bg-card px-2" value={form.legal_status} onChange={(e) => setForm({ ...form, legal_status: e.target.value })}>{["enacted", "pending", "failed", "repealed", "unknown"].map((s) => <option key={s}>{s}</option>)}</select>
              <select className="h-9 rounded-sm border border-input bg-card px-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
            </div>
            <Textarea className="font-mono text-xs" placeholder='Coverage JSON e.g. {"operator":"gte","fact":"property.units","value":2}' value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })} />
            <Textarea className="font-mono text-xs" placeholder="Exemptions JSON" value={form.exemptions} onChange={(e) => setForm({ ...form, exemptions: e.target.value })} />
            <label>Coverage status<select className="m-2 border" value={form.coverage_status} onChange={e=>setForm({...form,coverage_status:e.target.value})}>{["unknown","conditional","unconditional"].map(s=><option key={s}>{s}</option>)}</select></label>
            <label>Exemption status<select className="m-2 border" value={form.exemptions_status} onChange={e=>setForm({...form,exemptions_status:e.target.value})}>{["unknown","conditional","none"].map(s=><option key={s}>{s}</option>)}</select></label>
            <p className="text-xs">Changed legal claims require fresh verbatim evidence. Use fields quoted_span (requirement), key_value, legal_status, effective_date, coverage or exemptions.</p>
            <Textarea className="font-mono text-xs" placeholder='[{"field":"effective_date","quote":"exact source text"}]' value={form.supporting_quotes} onChange={e=>setForm({...form,supporting_quotes:e.target.value})}/>
            <Input placeholder="Reason for change (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <div className="flex gap-2">
              <Button disabled={form.reason.length < 5} onClick={() => save("reviewed")}>Save as reviewed</Button>
              <Button variant="outline" disabled={form.reason.length < 5} onClick={() => save("invalid")}>Mark invalid</Button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="paper space-y-2 rounded-sm p-5 text-sm">
              <h2 className="text-xl">Challenge semantic mapping</h2>
              <p className="text-xs text-muted-foreground">Link a T1–T5 challenge rule ID to this extracted provision. Transparent receipt; not ground truth.</p>
              <div className="flex flex-wrap gap-2">
                {CHALLENGE_IDS.map((cid) => {
                  const cur = mappings.data?.find((m) => m.challenge_rule_id === cid);
                  const mine = cur?.rule_key === r.rule_key;
                  return (
                    <Button key={cid} size="sm" variant={mine ? "default" : "outline"} onClick={async () => { await map({ data: { challengeId: cid, ruleKey: mine ? null : r.rule_key } }); qc.invalidateQueries({ queryKey: ["mappings"] }); toast.success(mine ? `Unmapped ${cid}` : `Mapped ${cid}`); }}>
                      {cid}{cur?.rule_key && !mine ? " *" : ""}
                    </Button>
                  );
                })}
              </div>
              <p className="text-[0.68rem] text-muted-foreground">* already mapped to another rule; clicking remaps.</p>
            </div>
            <div className="paper space-y-2 rounded-sm p-5 text-sm">
              <h2 className="text-xl">Record interaction</h2>
              <p className="text-xs text-muted-foreground">This rule → relation → other rule. Supersession requires same category.</p>
              <select className="h-9 w-full rounded-sm border border-input bg-card px-2" value={rel.type} onChange={(e) => setRel({ ...rel, type: e.target.value as never })}>{REL_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <select className="h-9 w-full rounded-sm border border-input bg-card px-2" value={rel.to} onChange={(e) => setRel({ ...rel, to: e.target.value })}>
                <option value="">Select other rule…</option>
                {(others.data ?? []).filter((o) => o.rule_key !== r.rule_key).map((o) => <option key={o.rule_key} value={o.rule_key}>{o.jurisdiction} · {o.title}</option>)}
              </select>
              <Input placeholder="Evidence / note" value={rel.note} onChange={(e) => setRel({ ...rel, note: e.target.value })} />
              <Textarea placeholder="Verbatim source quote supporting the interaction (required)" value={rel.quote} onChange={e=>setRel({...rel,quote:e.target.value})}/>
              <Button size="sm" disabled={rel.quote.length<20 || !rel.to || rel.note.length < 3} onClick={async () => { try { await relate({ data: { from_rule_key: r.rule_key, to_rule_key: rel.to, relation_type: rel.type, note: rel.note, evidence_quote:rel.quote } as never }); toast.success("Interaction recorded"); qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }}>Add interaction</Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
