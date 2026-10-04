import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getPortfolio } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Stat, Status, download } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/manager")({
  head: () => ({
    meta: [
      { title: "Property manager workspace — Housing Law Navigator" },
      { name: "description", content: "Sample portfolio obligations by category, unresolved facts, and exportable portfolio reports." },
      { property: "og:title", content: "Property manager workspace — Housing Law Navigator" },
      { property: "og:description", content: "Portfolio obligations and unresolved facts across the sample." },
    ],
  }),
  component: Manager,
});

function Manager() {
  const [asOf, setAsOf] = useState(DEFAULT_AS_OF);
  const [state, setState] = useState("all");
  const [city, setCity] = useState("all");
  const { data, isFetching } = useQuery({ queryKey: ["portfolio", asOf], queryFn: () => getPortfolio({ data: { asOf } }), placeholderData: (p) => p });
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (state === "all" || r.property.state === state) && (city === "all" || (r.property.postal_city ?? "") === city)), [data, state, city]);
  const cities = useMemo(() => Array.from(new Set((data?.rows ?? []).filter((r) => state === "all" || r.property.state === state).map((r) => r.property.postal_city ?? ""))).sort(), [data, state]);
  if (!data) return <p>Loading…</p>;

  const count = (cat: string, res: string) => rows.filter((r) => r.categories[cat] === res).length;
  const knownUnits = rows.reduce((s, r) => s + (r.property.units ?? 0), 0);

  function exportCsv() {
    const head = ["address_id", "street", "postal_city", "state", "units", "legal_place", ...CATEGORIES, "unknown_rules", "conflict"];
    const lines = rows.map((r) => [r.property.address_id, r.property.street_address, r.property.postal_city, r.property.state, r.property.units ?? "", r.resolution?.place_name ?? "", ...CATEGORIES.map((c) => r.categories[c] ?? ""), r.unknown_count, r.conflict].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([`# Not legal advice. Prototype using supplied public sources. As of ${asOf}. Sample only.\n` + [head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `portfolio-${asOf}.csv`; a.click();
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace II · Property manager" title="Sample portfolio obligations">
        Applicability is not evidence of compliance or violation. Property counts and known unit counts are reported separately; unknown units are not counted as zero.
      </PageHeader>
      <div className="flex flex-wrap items-end gap-3">
        <label><div className="eyebrow mb-1">As-of</div><Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="w-44" /></label>
        <label><div className="eyebrow mb-1">State</div>
          <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={state} onChange={(e) => { setState(e.target.value); setCity("all"); }}>
            {["all", "CA", "NJ", "MA"].map((s) => <option key={s}>{s}</option>)}
          </select></label>
        <label><div className="eyebrow mb-1">Postal city</div>
          <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="all">all</option>{cities.map((c) => <option key={c}>{c}</option>)}
          </select></label>
        <Button variant="outline" onClick={exportCsv}>Export portfolio CSV</Button>
        <Button variant="outline" onClick={() => download(`portfolio-${asOf}.json`, { disclaimer: "Not legal advice. Prototype using supplied public sources.", asOf, scope: "supplied sample only", rows })}>Export JSON</Button>
        <Link to="/changes" className="text-sm text-primary underline">Change impact →</Link>
        {isFetching && <span className="text-xs text-muted-foreground">Evaluating…</span>}
      </div>
      <Disclaimer asOf={asOf} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Properties in view" value={rows.length} />
        <Stat label="Known units" value={knownUnits} hint={`${rows.filter((r) => r.property.units == null).length} properties with unknown units`} />
        <Stat label="Jurisdiction unresolved" value={rows.filter((r) => r.resolution?.status !== "resolved").length} />
        <Stat label="Conflict flags" value={rows.filter((r) => r.conflict).length} hint="Need human review" />
      </div>
      <div className="paper overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="eyebrow border-b border-border text-left"><tr><th className="p-2">Category</th><th className="p-2">Applies</th><th className="p-2">Unknown</th><th className="p-2">Not yet effective</th><th className="p-2">Pending</th><th className="p-2">Superseded</th><th className="p-2">Not established</th></tr></thead>
          <tbody>{CATEGORIES.map((c) => (
            <tr key={c} className="border-b border-border/60"><td className="p-2">{CATEGORY_LABEL[c]}</td>
              {["applies", "unknown", "not_yet_effective", "pending", "superseded"].map((s) => <td key={s} className="p-2 font-mono">{count(c, s)}</td>)}
              <td className="p-2 font-mono text-muted-foreground">{rows.filter((r) => !r.categories[c]).length}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="paper max-h-[600px] overflow-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="eyebrow sticky top-0 border-b border-border bg-card text-left"><tr><th className="p-2">Property</th><th className="p-2">Units</th><th className="p-2">Legal city</th>{CATEGORIES.map((c) => <th key={c} className="p-2">{CATEGORY_LABEL[c]}</th>)}<th className="p-2">Unknowns</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.property.id} className="border-b border-border/60">
              <td className="p-2"><Link to="/property/$addressId" params={{ addressId: r.property.address_id }} className="text-primary hover:underline">{r.property.street_address}</Link><div className="font-mono text-[0.68rem] text-muted-foreground">{r.property.address_id} · {r.property.postal_city}</div></td>
              <td className="p-2 font-mono">{r.property.units ?? "?"}</td>
              <td className="p-2">{r.resolution?.status === "resolved" ? r.resolution.place_name ?? "—" : <Status value={r.resolution?.status ?? "unknown"} />}</td>
              {CATEGORIES.map((c) => <td key={c} className="p-2"><Status value={r.categories[c]} /></td>)}
              <td className="p-2 font-mono">{r.unknown_count}{r.conflict && <Status value="conflict" className="ml-1" />}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
