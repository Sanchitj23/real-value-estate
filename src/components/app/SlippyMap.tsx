import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";

/**
 * A small dependency-free web map: OpenStreetMap raster tiles, city outlines and address points drawn in SVG.
 * Drag to pan, wheel or buttons to zoom. Web Mercator, integer zoom levels.
 */
export type MapPlace = { geoid: string; name: string; state: string; polygons: number[][][][] };
export type MapPoint = { id: string; lat: number; lon: number; color: string; title: string; dim?: boolean | undefined };
export type MapArea = { fill: string; opacity: number };
export type Bounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

const TILE = 256, MIN_Z = 4, MAX_Z = 17;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const lonAt = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latAt = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

export function boundsOf(coords: Array<[number, number]>): Bounds | null {
  if (!coords.length) return null;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [lon, lat] of coords) { if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; }
  return { minLat, maxLat, minLon, maxLon };
}
export const placeBounds = (p: MapPlace) => boundsOf(p.polygons.flatMap((poly) => (poly[0] ?? []).map(([lon, lat]) => [lon ?? 0, lat ?? 0] as [number, number])));
export function mergeBounds(list: Array<Bounds | null>): Bounds | null {
  const ok = list.filter((b): b is Bounds => !!b);
  if (!ok.length) return null;
  return { minLat: Math.min(...ok.map((b) => b.minLat)), maxLat: Math.max(...ok.map((b) => b.maxLat)), minLon: Math.min(...ok.map((b) => b.minLon)), maxLon: Math.max(...ok.map((b) => b.maxLon)) };
}

type View = { lat: number; lon: number; z: number };

export function SlippyMap({ places, areas, points, selectedPoint, selectedPlace, focus, onPoint, onPlace, height = 520 }: {
  places: MapPlace[];
  /** Fill per place geoid; places without an entry are drawn as a plain outline. */
  areas: Record<string, MapArea>;
  points: MapPoint[];
  selectedPoint?: string | null | undefined;
  selectedPlace?: string | null | undefined;
  /** Change `key` to move the map to `bounds`. */
  focus: { key: string; bounds: Bounds | null };
  onPoint: (id: string) => void;
  onPlace: (geoid: string) => void;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ lat: 39, lon: -98, z: 4 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback((b: Bounds | null) => {
    if (!b || !width) return;
    const pad = 36;
    let z = MAX_Z;
    while (z > MIN_Z && (worldX(b.maxLon, z) - worldX(b.minLon, z) > width - pad * 2 || worldY(b.minLat, z) - worldY(b.maxLat, z) > height - pad * 2)) z--;
    setView({ z, lon: lonAt((worldX(b.minLon, z) + worldX(b.maxLon, z)) / 2, z), lat: latAt((worldY(b.minLat, z) + worldY(b.maxLat, z)) / 2, z) });
  }, [width, height]);

  // Refit only when the caller asks (focus.key) or the map first gets a size.
  const focusBounds = focus.bounds;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(focusBounds); }, [focus.key, width > 0]);

  const cx = worldX(view.lon, view.z), cy = worldY(view.lat, view.z);
  const left = cx - width / 2, top = cy - height / 2;
  const sx = (lon: number) => worldX(lon, view.z) - left, sy = (lat: number) => worldY(lat, view.z) - top;

  const zoomTo = useCallback((dz: number, at?: { x: number; y: number }) => {
    setView((v) => {
      const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z + dz));
      if (z === v.z) return v;
      const ax = at?.x ?? width / 2, ay = at?.y ?? height / 2;
      // Keep the point under the cursor fixed while the scale changes.
      const wx = worldX(v.lon, v.z) - width / 2 + ax, wy = worldY(v.lat, v.z) - height / 2 + ay;
      const k = 2 ** (z - v.z);
      return { z, lon: lonAt(wx * k - ax + width / 2, z), lat: latAt(wy * k - ay + height / 2, z) };
    });
  }, [width, height]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomTo(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top }); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const n = 2 ** view.z;
  const tiles: Array<{ key: string; src: string; x: number; y: number }> = [];
  if (width > 0) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n;
        tiles.push({ key: `${view.z}/${tx}/${ty}`, src: TILE_URL(view.z, wrapped, ty), x: tx * TILE - left, y: ty * TILE - top });
      }
    }
  }
  const pathOf = (p: MapPlace) => p.polygons.map((poly) => poly.map((ring) => ring.map(([lon, lat], i) => `${i ? "L" : "M"}${sx(lon ?? 0).toFixed(1)} ${sy(lat ?? 0).toFixed(1)}`).join("") + "Z").join("")).join("");
  const radius = view.z >= 12 ? 6 : view.z >= 9 ? 4.5 : 3;
  const clicked = (run: () => void) => () => { if (!drag.current?.moved) run(); };

  return (
    <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-border bg-muted" style={{ height, cursor: drag.current ? "grabbing" : "grab" }}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.buttons === 0) { drag.current = null; return; }
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: true };
        setHover(null);
        setView((v) => ({ z: v.z, lon: lonAt(worldX(v.lon, v.z) - dx, v.z), lat: latAt(worldY(v.lat, v.z) - dy, v.z) }));
      }}
      onPointerUp={() => { const d = drag.current; window.setTimeout(() => { if (drag.current === d) drag.current = null; }, 0); }}
      onPointerLeave={() => { drag.current = null; setHover(null); }}
      onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoomTo(1, { x: e.clientX - r.left, y: e.clientY - r.top }); }}>
      {tiles.map((t) => <img key={t.key} src={t.src} alt="" draggable={false} width={TILE} height={TILE} className="pointer-events-none absolute max-w-none" style={{ left: t.x, top: t.y, filter: "grayscale(0.55) contrast(0.92) brightness(1.04)" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />)}
      <svg width={width} height={height} className="absolute inset-0" role="img" aria-label="Map of sample addresses and city outlines">
        {places.map((p) => {
          const a = areas[p.geoid];
          const sel = selectedPlace === p.geoid;
          return <path key={p.geoid} d={pathOf(p)} fillRule="evenodd" style={{ fill: a?.fill ?? "transparent", fillOpacity: a ? a.opacity : 0, stroke: a?.fill ?? "var(--foreground)", strokeOpacity: sel ? 1 : 0.75, cursor: "pointer" }} strokeWidth={sel ? 3 : 1.5}
            onClick={clicked(() => onPlace(p.geoid))} onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: `${p.name}, ${p.state}` }); }} onMouseLeave={() => setHover(null)} />;
        })}
        {points.filter((p) => p.dim).map((p) => <circle key={p.id} cx={sx(p.lon)} cy={sy(p.lat)} r={radius * 0.8} style={{ fill: p.color, fillOpacity: 0.55, stroke: "var(--card)", cursor: "pointer" }} strokeWidth={0.75}
          onClick={clicked(() => onPoint(p.id))} onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: p.title }); }} onMouseLeave={() => setHover(null)} />)}
        {points.filter((p) => !p.dim).map((p) => <circle key={p.id} cx={sx(p.lon)} cy={sy(p.lat)} r={selectedPoint === p.id ? radius + 3 : radius} style={{ fill: p.color, stroke: selectedPoint === p.id ? "var(--ink)" : "var(--card)", cursor: "pointer" }} strokeWidth={selectedPoint === p.id ? 2.5 : 1}
          onClick={clicked(() => onPoint(p.id))} onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: p.title }); }} onMouseLeave={() => setHover(null)} />)}
        {view.z >= 8 && places.map((p) => { const b = placeBounds(p); if (!b) return null; return <text key={`t${p.geoid}`} x={sx((b.minLon + b.maxLon) / 2)} y={sy(b.maxLat) - 6} textAnchor="middle" className="pointer-events-none fill-ink text-[12px] font-medium" style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}>{p.name}</text>; })}
      </svg>
      {hover && <div className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md" style={{ left: Math.min(hover.x + 12, Math.max(0, width - 200)), top: hover.y + 12 }}>{hover.text}</div>}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" className="p-2 hover:bg-muted" onClick={() => zoomTo(1)}><Plus className="h-4 w-4" /></button>
        <button type="button" aria-label="Zoom out" className="border-t border-border p-2 hover:bg-muted" onClick={() => zoomTo(-1)}><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label="Fit to selection" className="border-t border-border p-2 hover:bg-muted" onClick={() => fit(focusBounds)}><Maximize2 className="h-4 w-4" /></button>
      </div>
      <div className="absolute bottom-1 right-1 z-10 rounded-sm bg-card/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a> contributors · outlines: US Census</div>
    </div>
  );
}
