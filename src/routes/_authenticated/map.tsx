import { useAsOf } from "@/hooks/useAsOf";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getLawChanges, getPortfolio } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, normCity } from "@/lib/engine/applicability";
import type { Tone } from "@/lib/engine/plain";
import { Disclaimer, Pill, TONE_COLOR } from "@/components/app/ui";
import { boundsOf, mergeBounds, placeBounds, SlippyMap, type MapArea, type MapPlace, type MapPoint } from "@/components/app/SlippyMap";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/map")({
  head: () => ({
    meta: [
      { title: "Map — Housing Law Navigator" },
      { name: "description", content: "Sample addresses and city outlines, coloured by the rental-law topic or law change you choose." },
      { property: "og:title", content: "Map — Housing Law Navigator" },
      { property: "og:description", content: "Interactive map of rental rules across the sample." },
    ],
  }),
  component: MapPage,
});

const STATES = [{ id: "all", label: "All" }, { id: "CA", label: "California" }, { id: "NJ", label: "New Jersey" }, { id: "MA", label: "Massachusetts" }] as const;
const LEGEND: Array<{ tone: Tone; label: string }> = [
  { tone: "applies", label: "Applies" }, { tone: "unknown", label: "May apply" }, { tone: "future", label: "Starts later" },
  { tone: "pending", label: "Proposed only" }, { tone: "none", label: "No rule found" },
];
const KIND_LABEL: Record<string, string> = { upcoming: "Starts later", proposed: "Proposed", recent: "Recently started", struck: "Struck down" };

function MapPage() {
  const [asOf, setAsOf] = useAsOf();
  const [layer, setLayer] = useState<string>("cat:rent_increase_limits");
  const [state, setState] = useState<string>("all");
  const [focusCity, setFocusCity] = useState<string | null>(null);
  const [selPoint, setSelPoint] = useState<string | null>(null);
  const [selPlace, setSelPlace] = useState<string | null>(null);

  const portfolio = useQuery({ queryKey: ["portfolio", asOf], queryFn: () => getPortfolio({ data: { asOf } }), throwOnError: false });
  const changes = useQuery({ queryKey: ["law-changes", asOf], queryFn: () => getLawChanges({ data: { asOf } }), throwOnError: false });
  const outlines = useQuery({
    queryKey: ["city-outlines"], staleTime: Infinity, throwOnError: false,
    queryFn: async () => { const r = await fetch("/data/city_outlines.json"); if (!r.ok) throw new Error("City outlines unavailable"); return (await r.json()) as { places: MapPlace[] }; },
  });

  const rows = useMemo(() => portfolio.data?.rows ?? [], [portfolio.data]);
  const places = useMemo(() => (outlines.data?.places ?? []).filter((p) => state === "all" || p.state === state), [outlines.data, state]);
  const laws = (changes.data?.items ?? []).filter((i) => i.kind !== "expired");
  const law = layer.startsWith("law:") ? laws.find((i) => i.rule_id === layer.slice(4)) ?? null : null;
  const cat = layer.startsWith("cat:") ? layer.slice(4) : null;

  const placeOfRow = (r: (typeof rows)[number]) => (r.resolution?.status === "resolved" && r.resolution.place_name ? `${r.property.state}:${normCity(r.resolution.place_name)}` : null);
  const placeKey = (p: MapPlace) => `${p.state}:${normCity(p.name)}`;
  const inState = rows.filter((r) => state === "all" || r.property.state === state);
  const located = inState.filter((r) => r.resolution?.status === "resolved" && r.resolution.lat != null && r.resolution.lon != null);

  const toneOf = (r: (typeof rows)[number]): Tone => {
    if (law) return law.in_area_ids.includes(r.property.address_id) ? (law.kind === "upcoming" ? "future" : law.kind === "proposed" ? "pending" : law.kind === "recent" ? "applies" : "superseded") : law.maybe_ids.includes(r.property.address_id) ? "unknown" : "none";
    return (cat ? r.category_summary[cat]?.tone : undefined) ?? "none";
  };

  const points: MapPoint[] = located.map((r) => {
    const tone = toneOf(r);
    return { id: r.property.address_id, lat: r.resolution!.lat!, lon: r.resolution!.lon!, color: TONE_COLOR[tone], dim: tone === "none", title: `${r.property.street_address} · ${r.resolution!.place_name ?? r.property.postal_city}` };
  });

  // Shade each city by the most common answer among its sample addresses (or by whether the chosen law reaches it).
  const areas: Record<string, MapArea> = {};
  const cityStats = new Map<string, { total: number; tones: Partial<Record<Tone, number>> }>();
  for (const r of inState) {
    const k = placeOfRow(r); if (!k) continue;
    const s = cityStats.get(k) ?? { total: 0, tones: {} };
    const t = toneOf(r); s.total++; s.tones[t] = (s.tones[t] ?? 0) + 1; cityStats.set(k, s);
  }
  for (const p of places) {
    if (law) {
      const reached = law.state === p.state && (law.level === "state" || normCity(law.city) === normCity(p.name));
      if (reached) areas[p.geoid] = { fill: TONE_COLOR[law.kind === "upcoming" ? "future" : law.kind === "proposed" ? "pending" : law.kind === "recent" ? "applies" : "superseded"], opacity: 0.28 };
      continue;
    }
    const s = cityStats.get(placeKey(p));
    if (!s) continue;
    const top = (Object.entries(s.tones) as Array<[Tone, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    areas[p.geoid] = { fill: TONE_COLOR[top], opacity: top === "none" ? 0.08 : 0.22 };
  }

  const focusPlace = focusCity ? places.find((p) => p.geoid === focusCity) ?? null : null;
  const focus = useMemo(() => ({
    key: `${state}|${focusCity ?? ""}|${places.length}|${located.length > 0}`,
    bounds: focusPlace ? placeBounds(focusPlace) : mergeBounds([...places.map(placeBounds), boundsOf(located.map((r) => [r.resolution!.lon!, r.resolution!.lat!] as [number, number]))]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, focusCity, places.length, located.length > 0]);

  const counts = LEGEND.map((l) => ({ ...l, n: inState.filter((r) => toneOf(r) === l.tone).length }));
  const row = selPoint ? rows.find((r) => r.property.address_id === selPoint) ?? null : null;
  const place = selPlace ? places.find((p) => p.geoid === selPlace) ?? null : null;
  const placeRows = place ? inState.filter((r) => placeOfRow(r) === placeKey(place)) : [];
  const loading = portfolio.isLoading || outlines.isLoading;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-serif text-3xl text-ink md:text-4xl">Map</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Choose a topic or a law. City outlines and addresses change colour to show the answer there. Click a city or an address for details.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-muted-foreground">Show
          <select className="mt-1 block h-9 max-w-xs rounded-md border border-input bg-card px-2 text-sm text-foreground" value={layer} onChange={(e) => { setLayer(e.target.value); setSelPoint(null); }}>
            <optgroup label="Topics">{CATEGORIES.map((c) => <option key={c} value={`cat:${c}`}>{CATEGORY_LABEL[c]}</option>)}</optgroup>
            {laws.length > 0 && <optgroup label="Law changes">{laws.map((i) => <option key={i.rule_id} value={`law:${i.rule_id}`}>{KIND_LABEL[i.kind] ?? i.kind}: {i.title.slice(0, 60)} ({i.jurisdiction})</option>)}</optgroup>}
          </select>
        </label>
        <div>
          <div className="text-sm text-muted-foreground">Area</div>
          <div className="mt-1 flex overflow-hidden rounded-md border border-input">
            {STATES.map((s) => <button key={s.id} type="button" onClick={() => { setState(s.id); setFocusCity(null); setSelPlace(null); }} className={cn("h-9 px-3 text-sm", state === s.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{s.label}</button>)}
          </div>
        </div>
        <label className="text-sm text-muted-foreground">As of
          <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="mt-1 w-40" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {places.map((p) => <button key={p.geoid} type="button" onClick={() => { setFocusCity(focusCity === p.geoid ? null : p.geoid); setSelPlace(p.geoid); setSelPoint(null); }} className={cn("rounded-full border px-2.5 py-1 text-xs", focusCity === p.geoid ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}>{p.name}</button>)}
      </div>

      {(portfolio.error || outlines.error) && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">Part of the map couldn't load: {(portfolio.error ?? outlines.error)?.message}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          {loading ? <div className="flex h-[520px] items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">Loading the map…</div>
            : <SlippyMap places={places} areas={areas} points={points} selectedPoint={selPoint} selectedPlace={selPlace} focus={focus}
                onPoint={(id) => { setSelPoint(id); setSelPlace(null); }} onPlace={(g) => { setSelPlace(g); setSelPoint(null); }} />}
          <p className="mt-2 text-xs text-muted-foreground">{located.length} of {inState.length} sample addresses are on the map. The other {inState.length - located.length} don't have a confirmed location yet. City outlines are simplified and are not a legal boundary ruling.</p>
        </div>

        <aside className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="font-medium text-foreground">{law ? law.title : cat ? CATEGORY_LABEL[cat] : ""}</div>
            {law && <p className="mt-1 text-xs text-muted-foreground">{KIND_LABEL[law.kind]}{law.effective_date ? ` · ${law.effective_date}` : ""} · {law.jurisdiction}. Coloured addresses are inside this law's area.</p>}
            <ul className="mt-3 space-y-1.5">
              {(law ? [
                { tone: (law.kind === "upcoming" ? "future" : law.kind === "proposed" ? "pending" : law.kind === "recent" ? "applies" : "superseded") as Tone, label: "In the law's area" },
                { tone: "unknown" as Tone, label: "City not confirmed" }, { tone: "none" as Tone, label: "Outside its area" },
              ].map((l) => ({ ...l, n: inState.filter((r) => toneOf(r) === l.tone).length })) : counts).map((l) => (
                <li key={l.label} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-card" style={{ background: TONE_COLOR[l.tone], opacity: l.tone === "none" ? 0.55 : 1 }} />{l.label}</span><span className="tabular-nums text-muted-foreground">{l.n}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Counts are sample addresses{state === "all" ? "" : ` in ${STATES.find((s) => s.id === state)?.label}`}, including those not on the map.</p>
          </div>

          {row && (
            <div className="rounded-lg border border-primary/50 bg-card p-4">
              <div className="font-serif text-lg text-ink">{row.property.street_address}</div>
              <div className="text-xs text-muted-foreground">{row.resolution?.place_name ?? row.property.postal_city}, {row.property.state} · {row.property.address_id}</div>
              <ul className="mt-3 space-y-1.5">
                {CATEGORIES.map((c) => <li key={c} className="flex items-center justify-between gap-2"><span className={cn(cat === c && "font-medium")}>{CATEGORY_LABEL[c]}</span><Pill tone={row.category_summary[c]?.tone ?? "none"}>{row.category_summary[c]?.short ?? "None found"}</Pill></li>)}
              </ul>
              <Link to="/property/$addressId" params={{ addressId: row.property.address_id }} className="mt-3 inline-flex items-center gap-1 font-medium text-primary hover:underline">Open report <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          )}

          {place && (
            <div className="rounded-lg border border-primary/50 bg-card p-4">
              <div className="font-serif text-lg text-ink">{place.name}, {place.state}</div>
              <div className="text-xs text-muted-foreground">{placeRows.length} sample address{placeRows.length === 1 ? "" : "es"} confirmed in this city</div>
              {placeRows.length > 0 && <ul className="mt-3 space-y-1.5">
                {LEGEND.map((l) => ({ ...l, n: placeRows.filter((r) => toneOf(r) === l.tone).length })).filter((l) => l.n > 0).map((l) => <li key={l.tone} className="flex items-center justify-between"><Pill tone={l.tone}>{law && l.tone !== "unknown" && l.tone !== "none" ? "In the law's area" : l.label}</Pill><span className="tabular-nums text-muted-foreground">{l.n}</span></li>)}
              </ul>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                <button className="font-medium text-primary underline" onClick={() => setFocusCity(place.geoid)}>Zoom here</button>
                <Link to="/renter" search={{ q: place.name }} className="font-medium text-primary underline">List its addresses</Link>
              </div>
            </div>
          )}
          {!row && !place && <p className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">Click a city outline or an address dot to see details here. Drag to move, scroll or use + and − to zoom.</p>}
        </aside>
      </div>
      <Disclaimer asOf={asOf} />
    </div>
  );
}
