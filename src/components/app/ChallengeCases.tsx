import { getData } from "@/lib/db-result";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runChangeTests, runScenario } from "@/lib/engine.functions";
import { createScenario } from "@/lib/admin.functions";
import { DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { ResultBadge, Stat, Status } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PatchSchema } from "@/lib/engine/validation";
import { Input } from "@/components/ui/input";

/** Organiser change cases T1–T5 (diagnostics, not a judge score). Mounted only when the section is opened. */
export function ChallengeCases() {
  const tests = useQuery({ queryKey: ["change-tests"], queryFn: () => runChangeTests(), throwOnError: false });
  if (tests.isLoading) return <p className="text-sm text-muted-foreground">Evaluating the five cases…</p>;
  if (tests.error) return <p role="alert" className="text-sm text-destructive">Couldn't evaluate the cases: {tests.error.message}</p>;
  return (
    <div className="space-y-4">
      {(tests.data ?? []).map((t) => (
        <article key={t.test_id} className="rounded-md border border-border bg-background p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-primary">{t.test_id}</span>
            <h3 className="font-sans text-base font-medium">{t.title}</h3>
            <Status value={t.status} kind="job" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground"><strong>Expected:</strong> {t.expected}</p>
          <p className="mt-1 text-xs">Linked rule: {Object.entries(t.mapping).map(([k, v]) => <span key={k} className="mr-3 font-mono">{k} → {v ?? "not linked yet"}</span>)}</p>
          {t.note && <p className="mt-1 text-xs text-st-unknown">{t.note}</p>}
          {t.per_rule.map((p) => (
            <div key={p.challenge_id} className="mt-3">
              {"check" in p && <p className="mb-2 text-xs">Specification check: <strong>{(p.check as { status: string }).status}</strong> (not an official judge score)</p>}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Stat label={`${p.challenge_id} changed`} value={p.summary.definitely_changed} />
                <Stat label="Possibly" value={p.summary.potentially_affected} />
                <Stat label="Unchanged" value={p.summary.unchanged} />
                <Stat label="Known units" value={p.summary.known_units_changed} />
                <Stat label="Unknown-unit props" value={p.summary.unknown_units_properties} />
              </div>
              <details className="mt-2 text-sm"><summary className="cursor-pointer text-primary">Address by address ({p.rows.length})</summary>
                <div className="max-h-72 overflow-auto"><table className="w-full text-xs"><tbody>{p.rows.map((x) => (
                  <tr key={x.address_id} className="border-b border-border/50"><td className="p-1 font-mono">{x.address_id}</td><td className="p-1">{x.street}</td><td className="p-1">{x.postal_city}</td><td className="p-1"><ResultBadge value={x.before} /></td><td className="p-1">→</td><td className="p-1"><ResultBadge value={x.after} /></td><td className="p-1">{x.label.replace(/_/g, " ")}</td><td className="p-1">{x.conflict_after && <Status value="conflict" />}</td></tr>
                ))}</tbody></table></div>
              </details>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">Affected addresses: {t.affected.length} · conflict flags: {t.conflicts.length}</p>
        </article>
      ))}
      {tests.data?.length === 0 && <p className="text-sm text-muted-foreground">No change cases came with the imported dataset.</p>}
    </div>
  );
}

/** Staff "what if" tool: patch one rule in memory and see which sample addresses change. Never alters stored law. */
export function Scenarios({ isStaff }: { isStaff: boolean }) {
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: async () => getData(await supabase.from("scenarios").select("*").order("created_at", { ascending: false })) ?? [], throwOnError: false });
  const rules = useQuery({ enabled: isStaff, queryKey: ["rule-keys"], queryFn: async () => getData(await supabase.from("rule_versions").select("rule_key,title,jurisdiction,category,source_documents!inner(dataset_versions!inner(status))").eq("source_documents.dataset_versions.status", "active").eq("is_current", true).order("rule_key")) ?? [], throwOnError: false });
  const [sel, setSel] = useState<string | null>(null);
  const scen = useQuery({ enabled: !!sel, queryKey: ["scenario", sel], queryFn: () => runScenario({ data: { scenarioId: sel! } }), throwOnError: false });
  const create = useServerFn(createScenario);
  const qc = useQueryClient();
  const [patchJson, setPatchJson] = useState("{}");
  const [f, setF] = useState({ name: "", rule_key: "", legal_status: "", effective_date: "", as_of: DEFAULT_AS_OF });
  const buildPatch = () => {
    const extra = JSON.parse(patchJson || "{}") as Record<string, unknown>;
    return PatchSchema.parse({ ...(f.legal_status ? { legal_status: f.legal_status } : {}), ...(f.effective_date ? { effective_date: f.effective_date } : {}), ...extra });
  };
  let preview = "";
  try { const p = buildPatch(); preview = Object.keys(p).length ? Object.entries(p).map(([k, v]) => `${k} → ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ") : "Nothing changed yet"; } catch { preview = "The extra JSON isn't valid"; }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">A “what if” changes one rule in memory and shows which sample addresses would get a different answer. It never changes the stored law and is always labelled hypothetical.</p>
      {(scenarios.error || scen.error) && <p role="alert" className="text-sm text-destructive">{(scenarios.error ?? scen.error)?.message}</p>}
      {isStaff ? (
        <div className="grid gap-2 rounded-md border border-border bg-background p-4 md:grid-cols-6">
          <Input placeholder="Name this what-if" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="md:col-span-2" />
          <select aria-label="Rule to change" className="h-9 rounded-md border border-input bg-card px-2 text-sm md:col-span-2" value={f.rule_key} onChange={(e) => setF({ ...f, rule_key: e.target.value })}>
            <option value="">Rule to change…</option>{(rules.data ?? []).map((r) => <option key={r.rule_key} value={r.rule_key}>{r.jurisdiction} · {r.title}</option>)}
          </select>
          <select aria-label="New status" className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={f.legal_status} onChange={(e) => setF({ ...f, legal_status: e.target.value })}><option value="">Status: keep</option>{["enacted", "pending", "failed", "repealed"].map((s) => <option key={s}>{s}</option>)}</select>
          <Input type="date" aria-label="New effective date" title="New effective date (leave blank to keep the current one)" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} />
          <label className="text-xs md:col-span-2">Evaluate on<Input type="date" value={f.as_of} onChange={(e) => setF({ ...f, as_of: e.target.value })} /></label>
          <label className="text-xs md:col-span-4">Optional: other fields as JSON (advanced)<Textarea className="font-mono" value={patchJson} onChange={(e) => setPatchJson(e.target.value)} placeholder='{"key_value":"5%","requirement":"Hypothetical cap"}' /></label>
          <p className="text-xs text-muted-foreground md:col-span-6">Will change only: <span className="font-mono">{preview}</span></p>
          <Button className="md:col-span-6" disabled={!f.name || !f.rule_key} onClick={async () => {
            try {
              const r = await create({ data: { name: f.name, rule_key: f.rule_key, as_of: f.as_of, patch: buildPatch() } });
              void qc.invalidateQueries({ queryKey: ["scenarios"] }); setSel(r.id); toast.success("What-if created");
            } catch (e) { toast.error((e as Error).message); }
          }}>Create and evaluate</Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">Creating a what-if needs a reviewer account. Ask an admin to give your account the reviewer role.</p>}
      <div className="flex flex-wrap gap-2">
        {(scenarios.data ?? []).map((s) => <Button key={s.id} size="sm" variant={sel === s.id ? "default" : "outline"} onClick={() => setSel(s.id)}>{s.name}</Button>)}
        {isStaff && !scenarios.data?.length && <p className="text-sm text-muted-foreground">No what-ifs yet.</p>}
      </div>
      {scen.data && (
        <div className="rounded-md border border-border bg-background p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Status value="hypothetical" /><span className="font-medium">{scen.data.scenario.name}</span><span className="font-mono text-xs text-muted-foreground">{JSON.stringify(scen.data.scenario.patch)} on {scen.data.scenario.rule_key}</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Definitely changed" value={scen.data.summary.definitely_changed} />
            <Stat label="Possibly" value={scen.data.summary.potentially_affected} />
            <Stat label="Unchanged" value={scen.data.summary.unchanged} />
            <Stat label="Known units" value={scen.data.summary.known_units_changed} />
            <Stat label="Sample size" value={scen.data.sample_size} hint="Sample only, not citywide" />
          </div>
          <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-xs"><tbody>{scen.data.rows.map((x) => (
            <tr key={x.address_id} className="border-b border-border/50"><td className="p-1 font-mono">{x.address_id}</td><td className="p-1">{x.street}</td><td className="p-1"><ResultBadge value={x.before} /></td><td className="p-1">→</td><td className="p-1"><ResultBadge value={x.after} /></td><td className="p-1">{x.label.replace(/_/g, " ")}<div className="text-muted-foreground">{x.before_key_value} → {x.after_key_value}</div>{x.before_requirement !== x.after_requirement && <details><summary>Requirement change</summary><p>Before: {x.before_requirement}</p><p>After: {x.after_requirement}</p></details>}</td></tr>
          ))}</tbody></table></div>
        </div>
      )}
    </div>
  );
}
