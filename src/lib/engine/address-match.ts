const ABBREV: Record<string, string> = {
  AVENUE: "AVE", AV: "AVE", STREET: "ST", BOULEVARD: "BLVD", DRIVE: "DR", ROAD: "RD", PLACE: "PL", COURT: "CT", LANE: "LN",
  TERRACE: "TER", PARKWAY: "PKWY", HIGHWAY: "HWY", SQUARE: "SQ", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
};
const GENERIC = new Set(["AVE", "ST", "BLVD", "DR", "RD", "PL", "CT", "LN", "TER", "PKWY", "HWY", "SQ", "WAY", "N", "S", "E", "W"]);

export function streetTokens(s: string): string[] {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((t) => ABBREV[t] ?? t);
}

type Addr = { address_id: string; street_address: string; postal_city: string | null; state: string; zip: string | null };

/**
 * Finds sample properties named in free text: by sample ID ("A0042") or by house number plus every distinctive
 * street-name word. A street name without a number never matches, so a vague question cannot pick a property.
 */
export function matchProperties<T extends Addr>(query: string, props: T[], limit = 3): T[] {
  const ids = new Set((query.toUpperCase().match(/\bA\d{3,5}\b/g) ?? []));
  const byId = props.filter((p) => ids.has(p.address_id.toUpperCase()));
  const q = new Set(streetTokens(query));
  const scored: Array<{ p: T; score: number }> = [];
  for (const p of props) {
    if (ids.has(p.address_id.toUpperCase())) continue;
    const t = streetTokens(p.street_address);
    const numbers = t.filter((x) => /^\d+$/.test(x));
    const names = t.filter((x) => !/^\d+$/.test(x) && !GENERIC.has(x) && x.length > 1);
    if (!numbers.length || !names.length) continue;
    if (!numbers.some((x) => q.has(x)) || !names.every((x) => q.has(x))) continue;
    let score = names.length + t.filter((x) => GENERIC.has(x) && q.has(x)).length * 0.5;
    if (p.postal_city && streetTokens(p.postal_city).every((x) => q.has(x))) score += 2;
    if (p.zip && q.has(p.zip)) score += 2;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.address_id.localeCompare(b.p.address_id));
  return [...byId, ...scored.map((s) => s.p)].slice(0, limit);
}
