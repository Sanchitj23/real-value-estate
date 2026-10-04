import { useAsOf } from "@/hooks/useAsOf";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { getPortfolio, getPropertyReport } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { categorySummary, sortOutcomes } from "@/lib/engine/plain";
import { Disclaimer, Pill, ResultBadge } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const portfolioQ = (asOf: string) => queryOptions({ queryKey: ["portfolio", asOf], queryFn: () => getPortfolio({ data: { asOf } }) });

export const Route = createFileRoute("/_authenticated/renter")({
  head: () => ({
    meta: [
      { title: "Find a property — Housing Law Navigator" },
      { name: "description", content: "Search the sample addresses and open a plain-language report of the rental rules that apply or may apply there." },
      { property: "og:title", content: "Find a property — Housing Law Navigator" },
      { property: "og:description", content: "Rental rules by address, with sources." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s['q'] === "string" && s['q'] ? { q: s['q'] } : {}),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ(DEFAULT_AS_OF)),
  component: Renter,
});

const SHORT: Record<string, string> = {
  rent_increase_limits: "Rent increases", just_cause_eviction: "Evictions", security_deposits: "Deposits",
  application_screening_fees: "Application fees", screening_restrictions: "Screening", algorithmic_rent_setting: "Pricing software",
};

function Renter() {
  const [asOf, setAsOf] = useAsOf();
  const { data } = useSuspenseQuery(portfolioQ(asOf));
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [limit, setLimit] = useState(12);
  const q = search.q ?? "";
  const setQ = (v: string) => navigate({ search: v ? { q: v } : {}, replace: true });
  const [picked, setPicked] = useState<string[]>([]);
  const [table, setTable] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => !s || `${r.property.address_id} ${r.property.street_address} ${r.property.postal_city} ${r.property.state} ${r.property.zip} ${r.resolution?.place_name ?? ""}`.toLowerCase().includes(s));
  }, [q, data.rows]);
  const list = matches.slice(0, limit);
  const compare = useQueries({
    queries: picked.map((id) => ({ queryKey: ["report", id, asOf], queryFn: () => getPropertyReport({ data: { addressId: id, asOf } }), throwOnError: false })),
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  const legalCity = (r: (typeof data.rows)[number]) => (r.resolution?.status === "resolved" ? r.resolution.place_name ?? "Outside any city" : null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl text-ink md:text-4xl">Find a property</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Search the 500 sample addresses. Open one to see which rental rules apply or may apply there, what each rule requires, and the legal text behind it. Tick up to three to compare them side by side.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Street, city, ZIP or sample ID (for example “Clinton St” or “A0001”)" aria-label="Search addresses" value={q} onChange={(e) => { setQ(e.target.value); setLimit(12); }} className="h-11 pl-9" />
        </div>
        <label className="text-sm text-muted-foreground">Rules as of
          <Input type="date" className="mt-1 h-11 w-44" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{q ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : `${data.rows.length} sample addresses`}{picked.length > 0 && ` · ${picked.length} selected to compare`}</span>
        <button className="underline" onClick={() => setTable((v) => !v)}>{table ? "Show cards" : "Show as a table"}</button>
      </div>

      {data.ruleCount === 0 && <p className="rounded-md border border-st-unknown/30 bg-st-unknown-bg/60 p-3 text-sm">The legal texts haven't been read yet, so no rules can be shown. This is a preparation step, not a sign that no law applies.</p>}

      {matches.length === 0 && <p className="rounded-md border border-border bg-card p-4 text-sm">No sample address matches “{q}”. This tool only covers the 500 supplied addresses, so an address outside the sample isn't an answer that no law applies.</p>}

      {!table && (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r) => {
            const city = legalCity(r);
            return (
              <article key={r.property.id} className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/property/$addressId" params={{ addressId: r.property.address_id }} className="font-serif text-lg text-ink hover:underline">{r.property.street_address}</Link>
                    <div className="text-sm text-muted-foreground">{r.property.postal_city}, {r.property.state} {r.property.zip} · {r.property.address_id}</div>
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={picked.includes(r.property.address_id)} disabled={!picked.includes(r.property.address_id) && picked.length >= 3} onChange={() => toggle(r.property.address_id)} />Compare</label>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{city ? <>Legal city: <span className="text-foreground">{city}</span></> : "Legal city not confirmed yet — city rules show as “may apply”"}</div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const s = r.category_summary[c];
                    return <li key={c}><Pill tone={s?.tone ?? "none"} className="gap-1 font-normal"><span className="font-medium">{SHORT[c]}</span>{` · ${(s?.short ?? "None found").toLowerCase()}`}</Pill></li>;
                  })}
                </ul>
                <Link to="/property/$addressId" params={{ addressId: r.property.address_id }} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Open report <ArrowRight className="h-3.5 w-3.5" /></Link>
              </article>
            );
          })}
        </div>
      )}

      {table && <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-2 font-medium">Compare</th><th className="p-2 font-medium">Address</th><th className="p-2 font-medium">Legal city</th>{CATEGORIES.map((c) => <th key={c} className="p-2 font-medium">{SHORT[c]}</th>)}</tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.property.id} className="border-b border-border/60 hover:bg-muted/50">
                <td className="p-2"><input type="checkbox" checked={picked.includes(r.property.address_id)} onChange={() => toggle(r.property.address_id)} aria-label={`Compare ${r.property.street_address}`} /></td>
                <td className="p-2"><Link to="/property/$addressId" params={{ addressId: r.property.address_id }} className="text-primary hover:underline">{r.property.street_address}</Link><div className="text-xs text-muted-foreground">{r.property.address_id} · {r.property.postal_city}, {r.property.state}</div></td>
                <td className="p-2">{legalCity(r) ?? <span className="text-muted-foreground">not confirmed</span>}</td>
                {CATEGORIES.map((c) => <td key={c} className="p-2"><span className="flex flex-col items-start gap-0.5">{(r.category_results[c] ?? []).length ? r.category_results[c]!.map((x) => <ResultBadge key={x} value={x} />) : <span className="text-xs text-muted-foreground">—</span>}</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {matches.length > limit && <Button variant="outline" onClick={() => setLimit((n) => n + 24)}>Show more addresses ({matches.length - limit} more)</Button>}

      {picked.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-2xl text-ink">Side by side</h2>
            <button className="text-sm underline" onClick={() => setPicked([])}>Clear selection</button>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">Same date ({asOf}) for every address. This shows what the rules say, not which property is “better”.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead><tr className="border-b border-border text-left align-bottom"><th className="w-40 p-2 text-xs font-medium text-muted-foreground">Topic</th>
                {compare.map((c, i) => (
                  <th key={picked[i]} className="p-2 font-medium">
                    {c.data ? <>
                      <Link to="/property/$addressId" params={{ addressId: c.data.property.address_id }} className="text-primary hover:underline">{c.data.property.street_address}</Link>
                      <div className="text-xs font-normal text-muted-foreground">{c.data.resolution?.status === "resolved" ? c.data.resolution.place_name ?? c.data.property.postal_city : `${c.data.property.postal_city} (city not confirmed)`}, {c.data.property.state}</div>
                    </> : c.isError ? <span className="text-destructive">Couldn't load {picked[i]}</span> : <span className="text-muted-foreground">Loading {picked[i]}…</span>}
                    <button aria-label={`Remove ${picked[i]}`} className="ml-1 align-middle text-muted-foreground hover:text-foreground" onClick={() => toggle(picked[i]!)}><X className="inline h-3.5 w-3.5" /></button>
                  </th>
                ))}</tr></thead>
              <tbody>
                {CATEGORIES.map((cat) => (
                  <tr key={cat} className="border-b border-border/60 align-top">
                    <td className="p-2 text-muted-foreground">{CATEGORY_LABEL[cat]}</td>
                    {compare.map((c, i) => {
                      const outs = sortOutcomes((c.data?.outcomes ?? []).filter((o) => o.category === cat && o.result));
                      const s = categorySummary(outs.map((o) => o.result));
                      return (
                        <td key={picked[i]} className="p-2">
                          {!c.data ? "…" : <>
                            <Pill tone={s.tone}>{s.parts.join(" · ") || s.headline}</Pill>
                            <ul className="mt-1.5 space-y-1.5">
                              {outs.slice(0, 3).map((o) => (
                                <li key={o.rule_id} className="text-xs">
                                  <span className="text-foreground">{o.key_value ?? o.title}</span>
                                  <span className="block text-muted-foreground">{o.title !== (o.key_value ?? o.title) ? `${o.title} · ` : ""}{o.jurisdiction}{o.conflict_flag ? " · conflict flagged" : ""}</span>
                                </li>
                              ))}
                              {outs.length > 3 && <li className="text-xs text-muted-foreground">+ {outs.length - 3} more in the report</li>}
                            </ul>
                          </>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Disclaimer asOf={asOf} />
    </div>
  );
}
