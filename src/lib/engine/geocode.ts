export type GeocodeInput = { street_address: string; state: string; zip: string | null; postal_city: string | null };
export type GeocodeAttempt = { label: string; params: Record<string, string> };

/** "876-878 S 14TH ST" -> "876 S 14TH ST"; null when the street has no number range. */
export function firstOfRange(street: string): string | null {
  const m = street.trim().match(/^(\d+)(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s+(.*)$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * Ordered Census geocoder requests for one address. The postal city is only a search hint: the legal place is always
 * read from the returned Census geography. The geocoder answers HTTP 400 when it gets neither ZIP nor city, so the
 * city hint is what makes ZIP-less rows (all San Francisco and Cambridge samples) searchable; a ZIP that does not
 * match the street (some NJ samples carry a New York ZIP) is retried without it.
 */
export function geocodeAttempts(p: GeocodeInput): GeocodeAttempt[] {
  const city = p.postal_city?.trim() || null;
  const zip = p.zip?.trim() || null;
  const base = (street: string, withZip: boolean, withCity: boolean) => ({
    street, state: p.state,
    ...(withZip && zip ? { zip } : {}),
    ...(withCity && city ? { city } : {}),
  });
  const out: GeocodeAttempt[] = [];
  const seen = new Set<string>();
  const add = (label: string, params: Record<string, string>) => {
    if (!params["zip"] && !params["city"]) return; // would be rejected with HTTP 400
    const key = JSON.stringify(params);
    if (!seen.has(key)) { seen.add(key); out.push({ label, params }); }
  };
  add("street+zip", base(p.street_address, true, false));
  add("street+city+zip", base(p.street_address, true, true));
  add("street+city", base(p.street_address, false, true));
  const first = firstOfRange(p.street_address);
  if (first) { add("first-of-range+city+zip", base(first, true, true)); add("first-of-range+city", base(first, false, true)); }
  return out;
}
