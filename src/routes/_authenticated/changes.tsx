import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runChangeTests, runScenario } from "@/lib/engine.functions";
import { createScenario } from "@/lib/admin.functions";
import { DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Stat, Status } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/changes")({
  head: () => ({
    meta: [
      { title: "Law changes & scenarios — Housing Law Navigator" },
      { name: "description", content: "Evaluate supplied change cases T1–T5 and separately labeled hypothetical scenarios across the property sample." },
      { property: "og:title", content: "Law changes & scenarios — Housing Law Navigator" },
      { property: "og:description", content: "Before/after outcomes for supplied change cases across the sample." },
    ],
  }),
  component: Changes,
});

function Changes() {
  const { isStaff } = useAuth();
  const tests = useQuery({ queryKey: ["change-tests"], queryFn: () => runChangeTests() });
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: async () => (await supabase.from("scenarios").select("*").order("created_at", { ascending: false })).data ?? [] });
  const rules = useQuery({ queryKey: ["rule-keys"], queryFn: async () => (await supabase.from("rule_versions").select("rule_key,title,jurisdiction,category").eq("is_current", true).order("rule_key")).data ?? [] });
  const [sel, setSel] = useState<string | null>(null);
  const scen = useQuery({ enabled: !!sel, queryKey: ["scenario", sel], queryFn: () => runScenario({ data: { scenarioId: sel! } }) });
  const create = useServerFn(createScenario);
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", rule_key: "", legal_status: "enacted", effective_date: "", as_of: DEFAULT_AS_OF });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Module C · Law → properties" title="Change cases and hypothetical scenarios">
        The same deterministic evaluator runs on two rule/date snapshots; affected sets cover only the 500 supplied sample properties. “Affected” means a change in reported applicability — not observed harm, violation or rent impact.
      </PageHeader>
      <Disclaimer />

      <section className="space-y-4">
        <h2 className="text-2xl">Supplied change cases (T1–T5)</h2>
        {tests.isLoading && <p className="text-sm">Evaluating…</p>}
        {(tests.data ?? []).map((t) => (
          <article key={t.test_id} className="paper rounded-sm p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-primary">{t.test_id}</span>
              <h3 className="font-serif text-xl">{t.title}</h3>
              <Status value={t.status === "evaluated" ? "resolved" : t.status === "partial" ? "ambiguous" : "none"} />
              <span className="text-xs text-muted-foreground">{t.status}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground"><strong>Specification:</strong> {t.expected}</p>
            <p className="mt-1 text-xs">Mapping: {Object.entries(t.mapping).map(([k, v]) => <span key={k} className="mr-3 font-mono">{k} → {v ?? "unmapped"}</span>)}</p>
            {t.note && <p className="mt-1 text-xs text-st-unknown">{t.note}</p>}
            {t.per_rule.map((p) => (
              <div key={p.challenge_id} className="mt-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Stat label={`${p.challenge_id} changed`} value={p.summary.definitely_changed} />
                  <Stat label="Potentially" value={p.summary.potentially_affected} />
                  <Stat label="Unchanged" value={p.summary.unchanged} />
                  <Stat label="Known units" value={p.summary.known_units_changed} />
                  <Stat label="Unknown-unit props" value={p.summary.unknown_units_properties} />
                </div>
                <details className="mt-2 text-sm"><summary className="cursor-pointer text-primary">Property-level before/after ({p.rows.length})</summary>
                  <div className="max-h-72 overflow-auto"><table className="w-full text-xs"><tbody>{p.rows.map((x) => (
                    <tr key={x.address_id} className="border-b border-border/50"><td className="p-1 font-mono">{x.address_id}</td><td className="p-1">{x.street}</td><td className="p-1">{x.postal_city}</td><td className="p-1"><Status value={x.before} /></td><td className="p-1">→</td><td className="p-1"><Status value={x.after} /></td><td className="p-1">{x.label.replace(/_/g, " ")}</td><td className="p-1">{x.conflict_after && <Status value="conflict" />}</td></tr>
                  ))}</tbody></table></div>
                </details>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">Affected addresses: {t.affected.length} · conflict flags: {t.conflicts.length}</p>
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Hypothetical scenarios <span className="ml-2 align-middle"><Status value="pending" /></span></h2>
        <p className="text-sm text-muted-foreground">A scenario is a structured patch on one rule. It never overwrites current law and is always labeled hypothetical.</p>
        {isStaff && (
          <div className="paper grid gap-2 rounded-sm p-4 md:grid-cols-6">
            <Input placeholder="Scenario name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="md:col-span-2" />
            <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm md:col-span-2" value={f.rule_key} onChange={(e) => setF({ ...f, rule_key: e.target.value })}>
              <option value="">Rule to patch…</option>{(rules.data ?? []).map((r) => <option key={r.rule_key} value={r.rule_key}>{r.jurisdiction} · {r.title}</option>)}
            </select>
            <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={f.legal_status} onChange={(e) => setF({ ...f, legal_status: e.target.value })}>{["enacted", "pending", "failed", "repealed"].map((s) => <option key={s}>{s}</option>)}</select>
            <Input type="date" title="Hypothetical effective date (optional)" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} />
            <Button className="md:col-span-6" disabled={!f.name || !f.rule_key} onClick={async () => {
              try {
                const r = await create({ data: { name: f.name, rule_key: f.rule_key, as_of: f.as_of, patch: { legal_status: f.legal_status as never, effective_date: f.effective_date || null } } });
                qc.invalidateQueries({ queryKey: ["scenarios"] }); setSel(r.id); toast.success("Scenario created");
              } catch (e) { toast.error((e as Error).message); }
            }}>Create & evaluate scenario</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(scenarios.data ?? []).map((s) => <Button key={s.id} size="sm" variant={sel === s.id ? "default" : "outline"} onClick={() => setSel(s.id)}>{s.name}</Button>)}
          {!scenarios.data?.length && <p className="text-sm text-muted-foreground">No scenarios yet.{!isStaff && <> <Link to="/auth" className="underline">Sign in</Link> as reviewer to create one.</>}</p>}
        </div>
        {scen.data && (
          <div className="paper rounded-sm p-4 text-sm">
            <div className="eyebrow">HYPOTHETICAL — {scen.data.scenario.name} · patch {JSON.stringify(scen.data.scenario.patch)} on {scen.data.scenario.rule_key}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Stat label="Definitely changed" value={scen.data.summary.definitely_changed} />
              <Stat label="Potentially" value={scen.data.summary.potentially_affected} />
              <Stat label="Unchanged" value={scen.data.summary.unchanged} />
              <Stat label="Known units" value={scen.data.summary.known_units_changed} />
              <Stat label="Sample size" value={scen.data.sample_size} hint="Sample only, not citywide" />
            </div>
            <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-xs"><tbody>{scen.data.rows.map((x) => (
              <tr key={x.address_id} className="border-b border-border/50"><td className="p-1 font-mono">{x.address_id}</td><td className="p-1">{x.street}</td><td className="p-1"><Status value={x.before} /></td><td className="p-1">→</td><td className="p-1"><Status value={x.after} /></td><td className="p-1">{x.label.replace(/_/g, " ")}</td></tr>
            ))}</tbody></table></div>
          </div>
        )}
      </section>
    </div>
  );
}
