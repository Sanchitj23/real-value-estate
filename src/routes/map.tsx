import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPortfolio } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Status } from "@/components/app/ui";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Sample map — Housing Law Navigator" },
      { name: "description", content: "Selected-category outcomes plotted only for sample properties with validated Census geocoder coordinates." },
      { property: "og:title", content: "Sample map — Housing Law Navigator" },
      { property: "og:description", content: "Sample-only map of rule outcomes with unmapped counts." },
    ],
  }),
  component: MapPage,
});

const COLOR: Record<string, string> = {
  applies: "var(--st-applies)", unknown: "var(--st-unknown)", not_yet_effective: "var(--st-future)",
  pending: "var(--st-pending)", superseded: "var(--st-superseded)", none: "var(--border)",
};

function MapPage() {
  const [cat, setCat] = useState<string>("algorithmic_rent_setting");
  const [state, setState] = useState("CA");
  const { data } = useQuery({ queryKey: ["portfolio", DEFAULT_AS_OF], queryFn: () => getPortfolio({ data: { asOf: DEFAULT_AS_OF } }) });
  const rows = (data?.rows ?? []).filter((r) => r.property.state === state);
  const pts = rows.filter((r) => r.resolution?.status === "resolved" && r.resolution.lat != null && r.resolution.lon != null);
  const unmapped = rows.length - pts.length;
  const lats = pts.map((p) => p.resolution!.lat!), lons = pts.map((p) => p.resolution!.lon!);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const W = 900, H = 560, pad = 30;
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const sx = (W - 2 * pad) / Math.max(1e-6, (maxLon - minLon) * kx), sy = (H - 2 * pad) / Math.max(1e-6, maxLat - minLat);
  const s = Math.min(sx, sy);
  const proj = (lat: number, lon: number) => [pad + (lon - minLon) * kx * s, H - pad - (lat - minLat) * s];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Reviewer · sample map" title="Where a category applies in the sample">
        Points are plotted only from validated geocoder coordinates. No invented pins; unmapped properties are counted and listed in the table fallback. This is not citywide coverage.
      </PageHeader>
      <Disclaimer />
      <div className="flex flex-wrap gap-3">
        <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={state} onChange={(e) => setState(e.target.value)}>{["CA", "NJ", "MA"].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="h-9 rounded-sm border border-input bg-card px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
        <div className="flex flex-wrap items-center gap-2 text-xs">{Object.keys(COLOR).map((k) => <Status key={k} value={k === "none" ? null : k} />)}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="paper rounded-sm p-2">
          {pts.length ? (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Map of ${pts.length} geocoded ${state} sample properties`}>
              {pts.map((p) => {
                const [x, y] = proj(p.resolution!.lat!, p.resolution!.lon!);
                const v = p.categories[cat] ?? "none";
                return (
                  <Link key={p.property.id} to="/property/$addressId" params={{ addressId: p.property.address_id }}>
                    <circle cx={x} cy={y} r={5} fill={COLOR[v]} stroke="var(--card)" strokeWidth={1}><title>{`${p.property.street_address} · ${p.resolution!.place_name ?? ""} · ${v}`}</title></circle>
                  </Link>
                );
              })}
            </svg>
          ) : <p className="p-8 text-center text-sm text-muted-foreground">No validated coordinates yet for {state}. Run jurisdiction resolution in Admin.</p>}
        </div>
        <aside className="paper space-y-2 rounded-sm p-4 text-sm">
          <div className="eyebrow">Coverage of this view</div>
          <div>{pts.length} mapped / {rows.length} sample properties</div>
          <div className="text-st-unknown">{unmapped} unmapped (unresolved, no match, ambiguous or error)</div>
          <div className="eyebrow pt-2">Outcome counts (mapped + unmapped)</div>
          {Object.keys(COLOR).map((k) => <div key={k} className="flex justify-between"><span>{k.replace(/_/g, " ")}</span><span className="font-mono">{rows.filter((r) => (r.categories[cat] ?? "none") === k).length}</span></div>)}
        </aside>
      </div>
    </div>
  );
}
