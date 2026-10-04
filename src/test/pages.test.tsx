import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Renders every signed-in page against a small synthetic dataset run through the real engine. The server functions
 * and the sign-in client are replaced with in-memory stand-ins, so these tests catch a page that crashes or loses
 * its key content; they do not check layout, the hosted database or the AI gateway.
 */
const USER = { id: "00000000-0000-4000-8000-000000000001", email: "renter@example.test", created_at: "2026-09-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] } };

vi.mock("@/integrations/supabase/client", () => {
  const result = { data: [], error: null };
  // A query builder that accepts any chain and resolves to an empty, successful result.
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, { get: (_t, prop) => (prop === "then" ? (ok: (v: typeof result) => unknown) => Promise.resolve(result).then(ok) : prop === "maybeSingle" || prop === "single" ? () => Promise.resolve({ data: null, error: null }) : () => chain) });
  return {
    supabase: {
      from: () => chain,
      auth: {
        getUser: async () => ({ data: { user: USER }, error: null }),
        getSession: async () => ({ data: { session: { user: USER } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
        updateUser: async () => ({ error: null }),
      },
    },
  };
});
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: async () => ({ error: null, redirected: true }) } } }));
vi.mock("@tanstack/react-start", async (original) => ({ ...(await original<Record<string, unknown>>()), useServerFn: (fn: unknown) => fn }));

const ask = vi.fn();
// The stand-in ledger: the test that asks a question spends one credit here, as the server would.
const ledger = vi.hoisted(() => ({ used: 0 }));
vi.mock("@/lib/assistant.functions", () => ({
  getMyCredits: async () => ({ balance: { unlimited: false, free: 2, granted: 0, used: ledger.used, remaining: 2 - ledger.used, requested: false }, recent: [] }),
  requestCredits: async () => ({ ok: true, already: false }),
  grantCredits: async () => ({ ok: true }),
  askAssistant: (...a: unknown[]) => ask(...a),
  // The free, instant answer: engine results as actionable points, no AI.
  getInsights: async ({ data }: { data: { question: string; asOf: string } }) => ({
    as_of: data.asOf, matched: true, headline: "6238 DE LONGPRE AVE: 1 rule applies · 1 rule may apply",
    insights: [
      { tone: "applies", title: "Application & screening fees: Synthetic $30 ceiling", detail: "A screening fee may not exceed the stated ceiling.", link: { kind: "rule", id: "r-ca-fee", label: "See the legal text" } },
      { tone: "unknown", title: "Check: whether the building is covered by the city ordinance", detail: "This decides 1 rule that may apply here.", link: { kind: "property", addressId: "A0001", label: "See those rules" } },
      { tone: "none", title: "See it in context", detail: "Open the full report or find the address on the map.", link: { kind: "map", address: "A0001", label: "Show on the map" } },
    ],
    cards: [{ type: "property", address_id: "A0001", street: "6238 DE LONGPRE AVE", place: "Los Angeles, CA", legal_city: "Los Angeles", categories: [{ category: "application_screening_fees", label: "Application & screening fees", tone: "applies", headline: "1 rule applies" }] }],
  }),
}));

vi.mock("@/lib/engine.functions", async () => {
  const { evaluateProperty, lifecycleOn, normCity } = await import("@/lib/engine/applicability");
  const { summarize } = await import("@/lib/engine/summary");
  const { lawChangeItems, dateDiff } = await import("@/lib/engine/changes-view");
  const prop = (n: number, street: string, city: string, state: string, units: number | null) => ({ id: `p${n}`, address_id: `A000${n}`, street_address: street, postal_city: city, state, zip: null, year_built: 1950, units, use_code: null, use_description: "Five or more apartments" });
  const properties = [prop(1, "6238 DE LONGPRE AVE", "Los Angeles", "CA", 32), prop(2, "1031-1035 CLINTON ST", "Hoboken", "NJ", null), prop(3, "134 Oxford St", "Cambridge", "MA", 6)];
  const place = (name: string, lat: number, lon: number) => ({ status: "resolved", place_name: name, place_kind: "incorporated", county_name: `${name} County`, lat, lon });
  const resolutions = new Map([["p1", place("Los Angeles", 34.09, -118.32)], ["p3", place("Cambridge", 42.38, -71.11)]]);
  const rule = (o: Record<string, unknown>) => ({ id: `r-${o["rule_key"]}`, version: 1, level: "state", city: null, key_value: null, citation: "Synthetic cite", source_url: null, source_doc_id: "D001", legal_status: "enacted", enacted_date: null, effective_date: null, expiry_date: null, coverage: null, exemptions: null, coverage_status: "unknown", exemptions_status: "unknown", review_state: "validated_auto", quoted_span: "Synthetic quote for the test fixture only.", confidence: 0.9, retrieved_at: "2026-10-01T22:00Z", ...o });
  const rules = [
    rule({ rule_key: "ca-fee", state: "CA", jurisdiction: "CA", category: "application_screening_fees", title: "Synthetic screening fee cap", requirement: "A screening fee may not exceed the stated ceiling.", key_value: "Synthetic $30 ceiling" }),
    rule({ rule_key: "la-rent", state: "CA", level: "city", city: "Los Angeles", jurisdiction: "Los Angeles, CA", category: "rent_increase_limits", title: "Synthetic city rent limit", requirement: "Rent may rise once a year.", coverage_status: "conditional", coverage_text: "Older buildings", coverage: { operator: "manual_review", reason: "Determine whether the building is covered by the city ordinance." } }),
    rule({ rule_key: "nj-alg", state: "NJ", jurisdiction: "NJ", category: "algorithmic_rent_setting", title: "Synthetic pricing-software ban", requirement: "Coordinated rental pricing is prohibited.", enacted_date: "2026-07-20", effective_clause: "This act shall take effect on the first day of the twelfth month next following the date of enactment." }),
    rule({ rule_key: "ma-bill", state: "MA", jurisdiction: "MA", category: "algorithmic_rent_setting", title: "Synthetic pending bill", requirement: "Would prohibit algorithmic rent setting.", legal_status: "pending" }),
  ] as never[];
  const inp = { properties, resolutions, rules, relations: [] } as never;
  const evalFor = (p: (typeof properties)[number], asOf: string) => evaluateProperty(p as never, (resolutions.get(p.id) ?? null) as never, rules, [], asOf);
  const ruleOf = (id: string) => (rules as Array<Record<string, unknown>>).find((r) => r["id"] === id)!;
  return {
    getOverview: async () => ({ dataset: { id: "d", receipt: {} }, counts: { properties: 3, sources: 87, captured: 54, rules: 4, reviewed: 0, invalid: 0, geocoded: 3, resolved: 2 } }),
    getPortfolio: async ({ data }: { data: { asOf: string } }) => ({
      asOf: data.asOf, ruleCount: rules.length,
      rows: properties.map((p) => ({ property: p, resolution: resolutions.get(p.id) ?? null, ...summarize(evalFor(p, data.asOf)) })),
    }),
    getPropertyReport: async ({ data }: { data: { addressId: string; asOf: string } }) => {
      const p = properties.find((x) => x.address_id === data.addressId);
      if (!p) return null;
      const outcomes = evalFor(p, data.asOf);
      return {
        asOf: data.asOf, property: p, resolution: resolutions.get(p.id) ?? null, summary: summarize(outcomes), ruleCount: rules.length,
        outcomes: outcomes.map((o) => ({ ...o, quoted_span: String(ruleOf(o.rule_id)["quoted_span"]), source_doc_id: "D001", requirement: String(ruleOf(o.rule_id)["requirement"]), source_url: null, retrieved_at: "2026-10-01T22:00Z" })),
        notCurrent: (rules as Array<Record<string, unknown>>).filter((r) => r["state"] === p.state && ["failed", "repealed"].includes(lifecycleOn(r as never, data.asOf)) && (r["level"] === "state" || normCity(r["city"] as string) === normCity(p.postal_city))).map((r) => ({ title: r["title"], jurisdiction: r["jurisdiction"], lifecycle: lifecycleOn(r as never, data.asOf), citation: r["citation"] })),
      };
    },
    getLawChanges: async ({ data }: { data: { asOf: string } }) => ({ asOf: data.asOf, sampleSize: 3, ruleCount: rules.length, items: lawChangeItems(inp, data.asOf) }),
    getDateDiff: async ({ data }: { data: { from: string; to: string } }) => ({ ...data, sampleSize: 3, items: dateDiff(inp, data.from, data.to) }),
    runChangeTests: async () => [],
    runScenario: async () => { throw new Error("not used"); },
    exportSubmission: async () => { throw new Error("not used"); },
  };
});

beforeAll(async () => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, json: async () => (String(url).includes("city_outlines") ? { places: [{ geoid: "0644000", name: "Los Angeles", state: "CA", polygons: [[[[-118.5, 34.0], [-118.2, 34.0], [-118.2, 34.3], [-118.5, 34.3], [-118.5, 34.0]]]] }] } : {}) }));
  // The document shell and its stylesheet links are the server's job; jsdom never finishes loading stylesheets.
  const { Route: root } = await import("@/routes/__root");
  root.update({ shellComponent: ({ children }: { children: React.ReactNode }) => <>{children}</>, head: () => ({}) } as never);
});
afterEach(async () => { cleanup(); ask.mockReset(); ledger.used = 0; (await import("@/components/app/Assistant")).resetAssistant(); });

async function open(path: string) {
  const { routeTree } = await import("@/routeTree.gen");
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("signed-in pages render their key content", () => {
  it("home leads with the assistant, shows free credits and has no readiness checklist", async () => {
    await open("/dashboard");
    expect(await screen.findByRole("heading", { name: /what do you want to know about a rental/i })).toBeTruthy();
    expect((await screen.findAllByText(/2 free AI summaries left/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/system readiness/i)).toBeNull();
    expect(screen.getAllByText("Account").length).toBeGreaterThan(0);
  });

  it("a question gets instant actionable points, then a plain-language summary and the new balance", async () => {
    ask.mockImplementation(async () => { ledger.used = 1; return reply; });
    const reply = ({ ok: true, answer: "Two rules matter here.\n- **Application fees**: capped [D001]\n\nNot legal advice.", follow_ups: ["What about deposits?"], ai: true, charged: true, as_of: "2026-10-01",
      balance: { unlimited: false, free: 2, granted: 0, used: 1, remaining: 1, requested: false },
      cards: [{ type: "property", address_id: "A0001", street: "6238 DE LONGPRE AVE", place: "Los Angeles, CA", legal_city: "Los Angeles", categories: [{ category: "application_screening_fees", label: "Application & screening fees", tone: "applies", headline: "1 rule applies" }] }] });
    await open("/dashboard");
    const box = await screen.findByLabelText("Your question");
    fireEvent.change(box, { target: { value: "What applies at 6238 De Longpre Ave?" } });
    fireEvent.submit(box.closest("form")!);
    expect(await screen.findByText("6238 DE LONGPRE AVE: 1 rule applies · 1 rule may apply")).toBeTruthy();
    expect(screen.getByText("Application & screening fees: Synthetic $30 ceiling")).toBeTruthy();
    expect(screen.getByRole("link", { name: /show on the map/i }).getAttribute("href")).toBe("/map?address=A0001");
    expect(await screen.findByText("Two rules matter here.")).toBeTruthy();
    expect(screen.getByText("1 rule applies")).toBeTruthy();
    expect(screen.getByText("D001")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/1 free AI summary left/i).length).toBeGreaterThan(0));
    expect(ask).toHaveBeenCalledWith({ data: { question: "What applies at 6238 De Longpre Ave?", asOf: "2026-10-01" } });
  });

  it("an account out of credits still gets the answer, and is told the AI summary needs credits", async () => {
    ask.mockResolvedValue({ ok: false, reason: "no_credits", balance: { unlimited: false, free: 2, granted: 0, used: 2, remaining: 0, requested: false } });
    await open("/dashboard");
    const box = await screen.findByLabelText("Your question");
    fireEvent.change(box, { target: { value: "Anything about Berkeley?" } });
    fireEvent.submit(box.closest("form")!);
    expect(await screen.findByText("Application & screening fees: Synthetic $30 ceiling")).toBeTruthy();
    expect(await screen.findByText(/you've used your free AI summaries/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /request more credits/i })).toBeTruthy();
  });

  it("find a property lists addresses with plain topic chips and filters from the URL", async () => {
    await open("/renter?q=clinton");
    expect(await screen.findByRole("heading", { name: "Find a property" })).toBeTruthy();
    expect(await screen.findByText("1031-1035 CLINTON ST")).toBeTruthy();
    expect(screen.queryByText("6238 DE LONGPRE AVE")).toBeNull();
    expect(screen.getByText(/legal city not confirmed yet/i)).toBeTruthy();
  });

  it("the property report summarises each topic before any detail", async () => {
    await open("/property/A0001");
    expect(await screen.findByRole("heading", { name: "6238 DE LONGPRE AVE" })).toBeTruthy();
    expect(screen.getByText(/at a glance/i)).toBeTruthy();
    expect(screen.getAllByText("1 rule applies").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 rule may apply").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Synthetic $30 ceiling").length).toBeGreaterThan(0);
    expect(screen.queryByText(/what must be established before acting/i)).toBeNull();
  });

  it("law changes groups laws by what is happening and counts the addresses reached", async () => {
    await open("/changes");
    expect(await screen.findByRole("heading", { name: "Law changes" })).toBeTruthy();
    expect(await screen.findByText("Synthetic pricing-software ban")).toBeTruthy();
    expect(screen.getByText(/starts 1 july 2027/i)).toBeTruthy();
    expect(screen.getByText("Synthetic pending bill")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /starting soon/i })).toBeTruthy();
  });

  it("a shared link runs its question once", async () => {
    ask.mockResolvedValue({ ok: false, reason: "no_credits", balance: { unlimited: false, free: 2, granted: 0, used: 2, remaining: 0, requested: false } });
    await open("/dashboard?ask=What%20applies%20at%206238%20De%20Longpre%20Ave%3F");
    expect(await screen.findByText("6238 DE LONGPRE AVE: 1 rule applies · 1 rule may apply")).toBeTruthy();
    expect(screen.getByText("What applies at 6238 De Longpre Ave?")).toBeTruthy();
  });

  it("the map opens on a linked address and shows its details", async () => {
    await open("/map?address=A0001&layer=cat:application_screening_fees");
    expect(await screen.findByText("6238 DE LONGPRE AVE")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open report/i }).getAttribute("href")).toBe("/property/A0001");
    expect(screen.getByRole("button", { name: "Application fees" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the map draws city outlines and one dot per placed address", async () => {
    await open("/map");
    expect(await screen.findByRole("heading", { name: "Map" })).toBeTruthy();
    const svg = await screen.findByRole("img", { name: /map of sample addresses/i });
    await waitFor(() => expect(svg.querySelectorAll("circle").length).toBe(2));
    expect(screen.getByLabelText("Find an address on the map")).toBeTruthy();
    expect(svg.querySelectorAll("path").length).toBe(1);
    expect(screen.getByText(/2 of 3 sample addresses are on the map/i)).toBeTruthy();
  });

  it("account shows the profile, plan and password sections", async () => {
    await open("/account");
    expect(await screen.findByRole("heading", { name: "Account" })).toBeTruthy();
    expect((await screen.findAllByText("renter@example.test")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /plan and credits/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save password/i })).toBeTruthy();
  });

  it("the full sample table is labelled as the sample, not a portfolio", async () => {
    await open("/manager");
    expect(await screen.findByRole("heading", { name: "All sample properties" })).toBeTruthy();
    expect(screen.queryByText(/your portfolio/i)).toBeNull();
  });

  it("staff pages send an ordinary account back to the home page", async () => {
    const router = await open("/admin");
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });
});
