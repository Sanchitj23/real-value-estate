import { useAsOf } from "@/hooks/useAsOf";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { getLawChanges, getPortfolio } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, normCity } from "@/lib/engine/applicability";
import type { Tone } from "@/lib/engine/plain";
import { Pill, TONE_COLOR } from "@/components/app/ui";
import { aroundPoint, boundsOf, mergeBounds, placeBounds, SlippyMap, type MapArea, type MapPlace, type MapPoint } from "@/components/app/SlippyMap";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MapSearch = { layer?: string; state?: string; address?: string };

export const Route = createFileRoute("/_authenticated/map")({
  head: () => ({
    meta: [
      { title: "Map — Housing Law Navigator" },
      { name: "description", content: "Sample addresses and city outlines, coloured by the rental-law topic or law change you choose." },
      { property: "og:title", content: "Map — Housing Law Navigator" },
      { property: "og:description", content: "Interactive map of rental rules across the sample." },
    ],
  }),
  // The view lives in the link, so a map state can be shared or opened straight from an answer.
  validateSearch: (s: Record<string, unknown>): MapSearch => ({
    ...(typeof s["layer"] === "string" && /^(cat|law):[\w-]+$/.test(s["layer"]) ? { layer: s["layer"] } : {}),
    ...(typeof s["state"] === "string" && ["CA", "NJ", "MA"].includes(s["state"]) ? { state: s["state"] } : {}),
    ...(typeof s["address"] === "string" && /^A\d{1,6}$/.test(s["address"]) ? { address: s["address"] } : {}),
  }),
  component: MapPage,
});

const STATES = [{ id: "all", label: "All" }, { id: "CA", label: "California" }, { id: "NJ", label: "New Jersey" }, { id: "MA", label: "Massachusetts" }] as const;
const SHORT: Record<string, string> = {
  rent_increase_limits: "Rent increases", just_cause_eviction: "Evictions", security_deposits: "Deposits",
  application_screening_fees: "Application fees", screening_restrictions: "Screening", algorithmic_rent_setting: "Pricing software",
};
const LEGEND: Array<{ tone: Tone; label: string }> = [
  { tone: "applies", label: "Applies" }, { tone: "unknown", label: "May apply" }, { tone: "future", label: "Starts later" },
  { tone: "pending", label: "Proposed only" }, { tone: "none", label: "No rule found" },
];
const KIND_LABEL: Record<string, string> = { upcoming: "Starts later", proposed: "Proposed", recent: "Recently started", struck: "Struck down" };
const KIND_TONE: Record<string, Tone> = { upcoming: "future", proposed: "pending", recent: "applies", struck: "superseded" };

function MapPage() {
  const [asOf, setAsOf] = useAsOf();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const layer = search.layer ?? "cat:rent_increase_limits";
  const state = search.state ?? "all";
  const selPoint = search.address ?? null;
  const patch = (next: Partial<MapSearch>, drop: Array<keyof MapSearch> = []) => navigate({ search: (prev) => { const out: MapSearch = { ...prev, ...next }; for (const k of drop) delete out[k]; return out; }, replace: true });

  const [focusCity, setFocusCity] = useState<string | null>(null);
  const [selPlace, setSelPlace] = useState<string | null>(null);
  // Zoom to an address only when it was chosen by search or arrived in the link, not when it was clicked on the map.
  const [flyTo, setFlyTo] = useState<string | null>(search.address ?? null);
  const [hidden, setHidden] = useState<Tone[]>([]);
  const [find, setFind] = useState("");

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
  const lawTone: Tone = law ? KIND_TONE[law.kind] ?? "superseded" : "none";

  type Row = (typeof rows)[number];
  const placeOfRow = (r: Row) => (r.resolution?.status === "resolved" && r.resolution.place_name ? `${r.property.state}:${normCity(r.resolution.place_name)}` : null);
  const placeKey = (p: MapPlace) => `${p.state}:${normCity(p.name)}`;
  const hasPoint = (r: Row) => r.resolution?.status === "resolved" && r.resolution.lat != null && r.resolution.lon != null;
  const inState = rows.filter((r) => state === "all" || r.property.state === state);
  const located = inState.filter(hasPoint);

  const toneOf = (r: Row): Tone => {
    if (law) return law.in_area_ids.includes(r.property.address_id) ? lawTone : law.maybe_ids.includes(r.property.address_id) ? "unknown" : "none";
    return (cat ? r.category_summary[cat]?.tone : undefined) ?? "none";
  };

  const points: MapPoint[] = located.filter((r) => !hidden.includes(toneOf(r)) || r.property.address_id === selPoint).map((r) => {
    const tone = toneOf(r);
    return { id: r.property.address_id, lat: r.resolution!.lat!, lon: r.resolution!.lon!, color: TONE_COLOR[tone], dim: tone === "none", title: `${r.property.street_address} · ${r.resolution!.place_name ?? r.property.postal_city}` };
  });

  // Shade each city by the most common answer among its sample addresses (or by whether the chosen law reaches it).
  const areas: Record<string, MapArea> = {};
  const cityStats = new Map<string, Partial<Record<Tone, number>>>();
  for (const r of inState) { const k = placeOfRow(r); if (!k) continue; const s = cityStats.get(k) ?? {}; const t = toneOf(r); s[t] = (s[t] ?? 0) + 1; cityStats.set(k, s); }
  for (const p of places) {
    if (law) { if (law.state === p.state && (law.level === "state" || normCity(law.city) === normCity(p.name))) areas[p.geoid] = { fill: TONE_COLOR[lawTone], opacity: 0.26 }; continue; }
    const s = cityStats.get(placeKey(p));
    if (!s) continue;
    const top = (Object.entries(s) as Array<[Tone, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    areas[p.geoid] = { fill: TONE_COLOR[top], opacity: top === "none" ? 0.07 : 0.2 };
  }

  const row = selPoint ? rows.find((r) => r.property.address_id === selPoint) ?? null : null;
  const flyRow = flyTo ? rows.find((r) => r.property.address_id === flyTo) ?? null : null;
  const focusPlace = focusCity ? (outlines.data?.places ?? []).find((p) => p.geoid === focusCity) ?? null : null;
  const focus = useMemo(() => ({
    key: `${state}|${focusCity ?? ""}|${flyTo ?? ""}|${places.length}|${located.length > 0}`,
    bounds: flyRow && hasPoint(flyRow) ? aroundPoint(flyRow.resolution!.lat!, flyRow.resolution!.lon!)
      : focusPlace ? placeBounds(focusPlace)
        // The cities' outlines frame the view; one far-away address (a single Lakewood row) must not stretch it.
        : places.length ? mergeBounds(places.map(placeBounds))
          : mergeBounds([boundsOf(located.map((r) => [r.resolution!.lon!, r.resolution!.lat!] as [number, number]))]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, focusCity, flyTo, places.length, located.length > 0, !!flyRow]);

  // A legend choice that no longer exists for the new layer should not keep hiding points.
  useEffect(() => { setHidden([]); }, [layer]);

  const legend = (law
    ? [{ tone: lawTone, label: "In the law's area" }, { tone: "unknown" as Tone, label: "City not confirmed" }, { tone: "none" as Tone, label: "Outside its area" }]
    : LEGEND).map((l) => ({ ...l, n: inState.filter((r) => toneOf(r) === l.tone).length }));
  const place = selPlace ? (outlines.data?.places ?? []).find((p) => p.geoid === selPlace) ?? null : null;
  const placeRows = place ? rows.filter((r) => placeOfRow(r) === placeKey(place)) : [];
  const q = find.trim().toLowerCase();
  const suggestions = q.length >= 2 ? rows.filter((r) => `${r.property.address_id} ${r.property.street_address} ${r.property.postal_city}`.toLowerCase().includes(q)).slice(0, 6) : [];
  const loading = portfolio.isLoading || outlines.isLoading;
  const choose = (id: string) => { const r = rows.find((x) => x.property.address_id === id); setFind(""); setSelPlace(null); setFocusCity(null); setFlyTo(id); patch({ address: id, ...(r && state !== "all" && r.property.state !== state ? { state: r.property.state } : {}) }); };
  const closeDetail = () => { setSelPlace(null); setFlyTo(null); patch({}, ["address"]); };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-ink md:text-4xl">Map</h1>
          <p className="mt-1 text-muted-foreground">Pick a topic or a law. Cities and addresses change colour to show the answer there.</p>
        </div>
        <label className="text-sm text-muted-foreground">As of
          <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="mt-1 w-40" />
        </label>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => <button key={c} type="button" onClick={() => patch({ layer: `cat:${c}` })} aria-pressed={layer === `cat:${c}`} className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", layer === `cat:${c}` ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}>{SHORT[c]}</button>)}
        {laws.length > 0 && (
          <select aria-label="Show a law change" className={cn("h-9 max-w-64 rounded-full border px-3 text-sm", law ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")} value={law ? layer : ""} onChange={(e) => e.target.value && patch({ layer: e.target.value })}>
            <option value="">Or a law change…</option>
            {laws.map((i) => <option key={i.rule_id} value={`law:${i.rule_id}`}>{KIND_LABEL[i.kind] ?? i.kind}: {i.title.slice(0, 52)} ({i.jurisdiction})</option>)}
          </select>
        )}
      </div>

      {(portfolio.error || outlines.error) && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">Part of the map couldn't load: {(portfolio.error ?? outlines.error)?.message}</div>}

      <div className="relative h-[calc(100vh-17rem)] min-h-[460px] overflow-hidden rounded-xl border border-border shadow-sm">
        {loading ? <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">Loading the map…</div> : (
          <SlippyMap places={places} areas={areas} points={points} selectedPoint={selPoint} selectedPlace={selPlace} focus={focus}
            onPoint={(id) => { setSelPlace(null); patch({ address: id }); }} onPlace={(g) => { setSelPlace(g); patch({}, ["address"]); }}>
            {/* Find an address, and area shortcuts */}
            <div data-map-ui className="absolute left-3 top-3 z-10 w-[min(21rem,calc(100%-1.5rem))] space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an address on the map" aria-label="Find an address on the map" className="h-10 rounded-lg bg-card pl-9 shadow-md" />
                {suggestions.length > 0 && (
                  <ul className="absolute inset-x-0 top-11 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                    {suggestions.map((r) => <li key={r.property.address_id}><button type="button" onClick={() => choose(r.property.address_id)} className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"><span className="truncate">{r.property.street_address}</span><span className="shrink-0 text-xs text-muted-foreground">{r.property.postal_city}, {r.property.state}{hasPoint(r) ? "" : " · not on map"}</span></button></li>)}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <div className="flex overflow-hidden rounded-lg border border-border bg-card shadow-md">
                  {STATES.map((s) => <button key={s.id} type="button" onClick={() => { setFocusCity(null); setSelPlace(null); setFlyTo(null); if (s.id === "all") patch({}, ["state", "address"]); else patch({ state: s.id }, ["address"]); }} className={cn("px-2.5 py-1.5 text-xs", state === s.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{s.label}</button>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {places.map((p) => <button key={p.geoid} type="button" onClick={() => { setFlyTo(null); setFocusCity(focusCity === p.geoid ? null : p.geoid); setSelPlace(p.geoid); patch({}, ["address"]); }} className={cn("rounded-full border px-2 py-0.5 text-xs shadow-sm", focusCity === p.geoid ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}>{p.name}</button>)}
              </div>
            </div>

            {/* Legend: click a row to hide or show those addresses */}
            <div data-map-ui className="absolute right-3 top-3 z-10 w-56 rounded-lg border border-border bg-card/95 p-3 text-sm shadow-md backdrop-blur">
              <div className="font-medium leading-snug text-foreground">{law ? law.title : cat ? CATEGORY_LABEL[cat] : ""}</div>
              {law && <div className="mt-0.5 text-xs text-muted-foreground">{KIND_LABEL[law.kind]}{law.effective_date ? ` · ${law.effective_date}` : ""} · {law.jurisdiction}</div>}
              <ul className="mt-2 space-y-0.5">
                {legend.map((l) => { const off = hidden.includes(l.tone); return (
                  <li key={l.label}><button type="button" aria-pressed={!off} title={off ? "Show these addresses" : "Hide these addresses"} onClick={() => setHidden((h) => (off ? h.filter((t) => t !== l.tone) : [...h, l.tone]))} className={cn("flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-muted", off && "opacity-40")}>
                    <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ background: TONE_COLOR[l.tone], opacity: l.tone === "none" ? 0.55 : 1 }} />{l.label}</span><span className="tabular-nums text-muted-foreground">{l.n}</span>
                  </button></li>
                ); })}
              </ul>
              <div className="mt-1.5 text-[11px] text-muted-foreground">Sample addresses{state === "all" ? "" : ` in ${STATES.find((s) => s.id === state)?.label}`}. Click a row to hide it.</div>
            </div>

            {/* Details for the chosen address or city */}
            {(row || place) && (
              <div data-map-ui className="absolute bottom-3 left-3 z-10 w-[min(22rem,calc(100%-5rem))] rounded-xl border border-border bg-card p-4 text-sm shadow-xl">
                <button type="button" aria-label="Close" onClick={closeDetail} className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
                {row ? <>
                  <div className="pr-6 font-serif text-lg leading-tight text-ink">{row.property.street_address}</div>
                  <div className="text-xs text-muted-foreground">{row.resolution?.status === "resolved" ? row.resolution.place_name ?? row.property.postal_city : `${row.property.postal_city} (legal city not confirmed)`}, {row.property.state} · {row.property.address_id}{hasPoint(row) ? "" : " · not on the map"}</div>
                  <ul className="mt-2.5 space-y-1">
                    {CATEGORIES.map((c) => <li key={c} className="flex items-center justify-between gap-2"><span className={cn(cat === c && "font-medium")}>{SHORT[c]}</span><Pill tone={row.category_summary[c]?.tone ?? "none"}>{row.category_summary[c]?.short ?? "None found"}</Pill></li>)}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    <Link to="/property/$addressId" params={{ addressId: row.property.address_id }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Open report <ArrowRight className="h-3.5 w-3.5" /></Link>
                    <Link to="/dashboard" search={{ ask: `What rental rules apply at ${row.property.street_address}?` }} className="font-medium text-primary hover:underline">Get the key points</Link>
                  </div>
                </> : place && <>
                  <div className="pr-6 font-serif text-lg leading-tight text-ink">{place.name}, {place.state}</div>
                  <div className="text-xs text-muted-foreground">{placeRows.length} sample address{placeRows.length === 1 ? "" : "es"} confirmed in this city</div>
                  {placeRows.length > 0 && <ul className="mt-2.5 space-y-1">
                    {(law ? [{ tone: lawTone, label: "In the law's area" }, { tone: "none" as Tone, label: "Outside its area" }] : LEGEND).map((l) => ({ ...l, n: placeRows.filter((r) => toneOf(r) === l.tone).length })).filter((l) => l.n > 0).map((l) => <li key={l.label} className="flex items-center justify-between"><Pill tone={l.tone}>{l.label}</Pill><span className="tabular-nums text-muted-foreground">{l.n}</span></li>)}
                  </ul>}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    <button className="font-medium text-primary hover:underline" onClick={() => { setFlyTo(null); setFocusCity(place.geoid); }}>Zoom here</button>
                    <Link to="/renter" search={{ q: place.name }} className="font-medium text-primary hover:underline">List its addresses</Link>
                  </div>
                </>}
              </div>
            )}
          </SlippyMap>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{located.length} of {inState.length} sample addresses are on the map; {inState.length - located.length} don't have a confirmed location yet. Drag to move, scroll or double-click to zoom. City outlines are simplified and are not a legal boundary ruling. Not legal advice.</p>
    </div>
  );
}
