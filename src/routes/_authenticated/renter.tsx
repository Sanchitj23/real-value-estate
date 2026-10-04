import { useAsOf } from "@/hooks/useAsOf";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getPortfolio, getPropertyReport } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Status } from "@/components/app/ui";
import { Input } from "@/components/ui/input";

const portfolioQ = (asOf: string) => queryOptions({ queryKey: ["portfolio", asOf], queryFn: () => getPortfolio({ data: { asOf } }) });

export const Route = createFileRoute("/_authenticated/renter")({
  head: () => ({
    meta: [
      { title: "Renter workspace — Housing Law Navigator" },
      { name: "description", content: "Find rental protections at a sample address, see what is unknown, and compare up to three properties." },
      { property: "og:title", content: "Renter workspace — Housing Law Navigator" },
      { property: "og:description", content: "Protections, missing facts and citations by address." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s['q'] === "string" && s['q'] ? { q: s['q'] } : {}),
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQ(DEFAULT_AS_OF)),
  component: Renter,
});

function Renter() {
  const [asOf, setAsOf] = useAsOf();
  const { data } = useSuspenseQuery(portfolioQ(asOf));
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [limit,setLimit]=useState(40);
  const q = search.q ?? "";
  const setQ = (v: string) => navigate({ search: v ? { q: v } : {}, replace: true });
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => !s || `${r.property.address_id} ${r.property.street_address} ${r.property.postal_city} ${r.property.zip}`.toLowerCase().includes(s)).slice(0, limit);
  }, [q, data.rows,limit]);
  const compare = useQueries({
    queries: picked.map((id) => ({ queryKey: ["report", id, asOf], queryFn: () => getPropertyReport({ data: { addressId: id, asOf } }) })),
  });

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace I · Renter / prospective occupant" title="What protects me at this address?">
        Search the 500 supplied sample addresses. Results show protection categories, the facts still needed, and the exact source quote behind each rule. Pick up to three to compare legal profiles — this is not a “best property” score.
      </PageHeader>
      <Disclaimer asOf={asOf} />
      <label>As of <Input type="date" className="w-44" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label>
      {data.ruleCount === 0 && <p className="text-sm text-st-unknown">No rules extracted yet — categories will show as not established until a reviewer runs extraction.</p>}
      <Input placeholder="Search by street, ZIP, postal city or ID (e.g. A0001)" value={q} onChange={(e) => {setQ(e.target.value);setLimit(40)}} className="max-w-xl" />
      <div className="paper overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="eyebrow border-b border-border text-left"><tr><th className="p-2">Compare</th><th className="p-2">Address</th><th className="p-2">Postal city</th><th className="p-2">Legal city</th>{CATEGORIES.map((c) => <th key={c} className="p-2">{CATEGORY_LABEL[c]}</th>)}</tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.property.id} className="border-b border-border/60 hover:bg-muted/50">
                <td className="p-2"><input type="checkbox" checked={picked.includes(r.property.address_id)} onChange={() => toggle(r.property.address_id)} aria-label={`Compare ${r.property.street_address}`} /></td>
                <td className="p-2"><Link to="/property/$addressId" params={{ addressId: r.property.address_id }} className="text-primary underline-offset-2 hover:underline">{r.property.street_address}</Link><div className="font-mono text-[0.68rem] text-muted-foreground">{r.property.address_id} · {r.property.state} {r.property.zip}</div></td>
                <td className="p-2 text-muted-foreground">{r.property.postal_city}</td>
                <td className="p-2">{r.resolution?.status === "resolved" ? r.resolution.place_name ?? "unincorporated" : <Status value="unknown" />}</td>
                {CATEGORIES.map((c) => <td key={c} className="p-2"><Status value={r.categories[c]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.length===0 && <p>No matching address in the supplied sample. This does not mean that no law applies.</p>}
      {list.length===limit && <button className="underline" onClick={()=>setLimit(n=>n+40)}>Show more addresses</button>}
      {picked.length > 0 && (
        <section>
          <h2 className="mb-3 text-2xl">Legal profile comparison</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {compare.map((c, i) => {
              const r = c.data;
              if (!r) return <div key={i} className="paper rounded-sm p-4 text-sm">Loading…</div>;
              return (
                <div key={r.property.address_id} className="paper rounded-sm p-4">
                  <div className="font-serif text-lg">{r.property.street_address}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.property.address_id} · {r.property.postal_city}, {r.property.state}</div>
                  <ul className="mt-3 space-y-2 text-sm">
                    {CATEGORIES.map((cat) => {
                      const outs = r.outcomes.filter((o) => o.category === cat && o.result);
                      return (
                        <li key={cat} className="flex items-start justify-between gap-2 border-b border-border/50 pb-1">
                          <span>{CATEGORY_LABEL[cat]}</span>
                          <span className="flex flex-col items-end gap-0.5">{outs.length ? outs.map((o) => <Status key={o.rule_id} value={o.result} />) : <span className="text-xs text-muted-foreground">not established</span>}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3 text-xs text-muted-foreground">{Array.from(new Set(r.outcomes.flatMap((o) => o.missing))).length} distinct facts needed to resolve unknowns.</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
