import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getDateDiff, getLawChanges, getPortfolio } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/engine/applicability";
import { QueryDate } from "@/lib/engine/dates";
import type { ChangeItem, ChangeKind } from "@/lib/engine/changes-view";
import type { Tone } from "@/lib/engine/plain";
import { useAsOf } from "@/hooks/useAsOf";
import { useAuth } from "@/hooks/useAuth";
import { ChallengeCases, Scenarios } from "@/components/app/ChallengeCases";
import { Disclaimer, Pill, ResultBadge } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/changes")({
  head: () => ({
    meta: [
      { title: "Law changes — Housing Law Navigator" },
      { name: "description", content: "Rental laws that are starting, proposed, recently started or struck down, and which sample addresses each one reaches." },
      { property: "og:title", content: "Law changes — Housing Law Navigator" },
      { property: "og:description", content: "What is changing in rental law and who it reaches." },
    ],
  }),
  component: Changes,
});

const SECTIONS: Array<{ kind: ChangeKind; title: string; blurb: string; tone: Tone; pill: string }> = [
  { kind: "upcoming", title: "Starting soon", blurb: "Passed into law, but not in effect yet.", tone: "future", pill: "Starts later" },
  { kind: "proposed", title: "Proposed", blurb: "Bills and proposals. None of these is law.", tone: "pending", pill: "Proposed" },
  { kind: "recent", title: "Started in the last 12 months", blurb: "Already in effect.", tone: "applies", pill: "In effect" },
  { kind: "struck", title: "Struck down or failed", blurb: "Measures that did not become law.", tone: "superseded", pill: "Not law" },
];
const STATES: Record<string, string> = { CA: "California", NJ: "New Jersey", MA: "Massachusetts" };

const niceDate = (d: string | null) => {
  if (!d) return null;
  return d.length === 10 ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : d;
};
const shiftYear = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

function ChangeCard({ item, section, streets }: { item: ChangeItem; section: (typeof SECTIONS)[number]; streets: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const where = item.level === "state" ? STATES[item.state] ?? item.state : item.city ?? item.jurisdiction;
  const date = niceDate(item.effective_date);
  const when = item.kind === "upcoming" ? `Starts ${date}` : item.kind === "recent" ? `In effect since ${date}` : item.kind === "proposed" ? "Not law yet" : item.kind === "struck" ? "Did not become law" : "No longer current";
  const ids = [...item.in_area_ids, ...item.maybe_ids];
  const shown = all ? ids : ids.slice(0, 24);
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={section.tone}>{when}</Pill>
        <span className="text-muted-foreground">{where} · {CATEGORY_LABEL[item.category]}</span>
      </div>
      <h3 className="mt-2 font-sans text-base font-medium text-foreground">{item.title}</h3>
      {item.key_value && <div className="font-serif text-lg leading-snug text-ink">{item.key_value}</div>}
      <p className="mt-1 text-sm text-muted-foreground">{item.requirement}</p>
      {item.date_derived && <p className="mt-1 text-xs text-muted-foreground">{item.date_basis === "state_default" ? "The text gives no start date, so California's general rule is used: a statute takes effect on 1 January after it is enacted." : "The start date is worked out from the law's own wording about when it takes effect."}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
        <span>
          <strong className="font-medium">{item.in_area_ids.length}</strong> sample address{item.in_area_ids.length === 1 ? "" : "es"} in {where}
          {item.maybe_ids.length > 0 && <span className="text-muted-foreground"> · {item.maybe_ids.length} more where the legal city isn't confirmed</span>}
        </span>
        {ids.length > 0 && <button className="font-medium text-primary underline" onClick={() => setOpen((v) => !v)}>{open ? "Hide addresses" : "See addresses"}</button>}
        <Link to="/rules/$id" params={{ id: item.rule_id }} className="inline-flex items-center gap-1 text-primary hover:underline">Rule and legal text <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      {open && (
        <div className="mt-3">
          <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((id) => <li key={id} className="truncate"><Link to="/property/$addressId" params={{ addressId: id }} className="text-primary hover:underline">{streets.get(id) ?? id}</Link>{item.maybe_ids.includes(id) && <span className="text-xs text-muted-foreground"> (city not confirmed)</span>}</li>)}
          </ul>
          {ids.length > 24 && <button className="mt-2 text-sm underline" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${ids.length}`}</button>}
          <p className="mt-2 text-xs text-muted-foreground">“In {where}” means inside the law's area. Whether it covers a particular building can depend on facts shown in that property's report.</p>
        </div>
      )}
    </article>
  );
}

function Changes() {
  const { isStaff } = useAuth();
  const [asOf, setAsOf] = useAsOf();
  const changes = useQuery({ queryKey: ["law-changes", asOf], queryFn: () => getLawChanges({ data: { asOf } }), throwOnError: false });
  const portfolio = useQuery({ queryKey: ["portfolio", asOf], queryFn: () => getPortfolio({ data: { asOf } }), throwOnError: false });
  const streets = useMemo(() => new Map((portfolio.data?.rows ?? []).map((r) => [r.property.address_id, `${r.property.street_address}, ${r.property.postal_city ?? r.property.state}`])), [portfolio.data]);
  const [state, setState] = useState("all");
  const [topic, setTopic] = useState("all");
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [from, setFrom] = useState(asOf), [to, setTo] = useState(shiftYear(asOf, 1));
  const diff = useQuery({ enabled: !!range, queryKey: ["date-diff", range?.from, range?.to], queryFn: () => getDateDiff({ data: range! }), throwOnError: false });
  const [staffOpen, setStaffOpen] = useState<{ cases: boolean; whatIf: boolean }>({ cases: false, whatIf: false });

  const items = (changes.data?.items ?? []).filter((i) => (state === "all" || i.state === state) && (topic === "all" || i.category === topic));
  const validRange = QueryDate.safeParse(from).success && QueryDate.safeParse(to).success && from !== to;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl text-ink md:text-4xl">Law changes</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Rental laws that are about to start, have been proposed, or started recently, and how many of the sample addresses each one reaches. Open a card to see the addresses.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-muted-foreground">Looking from
          <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="mt-1 w-44" />
        </label>
        <label className="text-sm text-muted-foreground">State
          <select className="mt-1 block h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">All three states</option>{Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm text-muted-foreground">Topic
          <select className="mt-1 block h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="all">All topics</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
      </div>

      {changes.isLoading && <p className="text-sm text-muted-foreground">Working out what is changing…</p>}
      {changes.error && <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">Couldn't load law changes ({changes.error.message}). <button className="underline" onClick={() => changes.refetch()}>Try again</button></div>}
      {changes.data && changes.data.ruleCount === 0 && <p className="rounded-md border border-st-unknown/30 bg-st-unknown-bg/60 p-4 text-sm">The legal texts haven't been read yet, so there are no changes to show.</p>}

      {changes.data && SECTIONS.map((s) => {
        const list = items.filter((i) => i.kind === s.kind);
        if (!list.length) return s.kind === "struck" ? null : (
          <section key={s.kind}><h2 className="font-serif text-2xl text-ink">{s.title}</h2><p className="mt-1 text-sm text-muted-foreground">Nothing in this group for the filters you chose.</p></section>
        );
        const shown = more[s.kind] ? list : list.slice(0, 4);
        return (
          <section key={s.kind} className="space-y-3">
            <div><h2 className="font-serif text-2xl text-ink">{s.title} <span className="font-sans text-base text-muted-foreground">({list.length})</span></h2><p className="text-sm text-muted-foreground">{s.blurb}</p></div>
            <div className="grid gap-3 lg:grid-cols-2">{shown.map((i) => <ChangeCard key={i.rule_id} item={i} section={s} streets={streets} />)}</div>
            {list.length > 4 && <button className="text-sm font-medium text-primary underline" onClick={() => setMore((m) => ({ ...m, [s.kind]: !m[s.kind] }))}>{more[s.kind] ? "Show fewer" : `Show all ${list.length}`}</button>}
          </section>
        );
      })}

      {changes.data && items.some((i) => i.kind === "expired") && (
        <details className="rounded-lg border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">No longer current ({items.filter((i) => i.kind === "expired").length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">{items.filter((i) => i.kind === "expired").map((i) => <li key={i.rule_id}><Link to="/rules/$id" params={{ id: i.rule_id }} className="text-primary hover:underline">{i.title}</Link> — {i.jurisdiction}{i.expiry_date ? ` · ended ${niceDate(i.expiry_date)}` : ""}</li>)}</ul>
        </details>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-serif text-2xl text-ink">Compare two dates</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick two dates to see which answers change between them, and for how many addresses.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-44" /></label>
          <label className="text-sm text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-44" /></label>
          <Button disabled={!validRange} onClick={() => setRange({ from, to })}>Compare</Button>
          <Button variant="outline" onClick={() => { const r = { from: asOf, to: shiftYear(asOf, 1) }; setFrom(r.from); setTo(r.to); setRange(r); }}>The next 12 months</Button>
        </div>
        {diff.isFetching && <p className="mt-3 text-sm text-muted-foreground">Comparing…</p>}
        {diff.error && <p role="alert" className="mt-3 text-sm text-destructive">Couldn't compare those dates: {diff.error.message}</p>}
        {diff.data && !diff.isFetching && (diff.data.items.length === 0
          ? <p className="mt-3 text-sm">Nothing changes for the sample addresses between {niceDate(diff.data.from)} and {niceDate(diff.data.to)}.</p>
          : <ul className="mt-4 divide-y divide-border text-sm">
            {diff.data.items.map((d) => (
              <li key={`${d.rule_key}${d.before}${d.after}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0"><Link to="/rules/$id" params={{ id: d.rule_id }} className="font-medium text-foreground hover:underline">{d.title}</Link><span className="block text-xs text-muted-foreground">{d.jurisdiction} · {CATEGORY_LABEL[d.category]}</span></span>
                <span className="flex items-center gap-2 whitespace-nowrap">{d.before ? <ResultBadge value={d.before} /> : <Pill tone="none">Not reported</Pill>}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />{d.after ? <ResultBadge value={d.after} /> : <Pill tone="none">Not reported</Pill>}<span className="w-28 text-right text-muted-foreground">{d.address_ids.length} address{d.address_ids.length === 1 ? "" : "es"}</span></span>
              </li>
            ))}
          </ul>)}
      </section>

      <section className="space-y-3">
        <details className="rounded-lg border border-border bg-card p-4" onToggle={(e) => setStaffOpen((s) => ({ ...s, whatIf: e.currentTarget.open }))}>
          <summary className="cursor-pointer font-medium">What if a law changed? (hypothetical)</summary>
          <div className="mt-3">{staffOpen.whatIf && <Scenarios isStaff={isStaff} />}</div>
        </details>
        <details className="rounded-lg border border-border bg-card p-4" onToggle={(e) => setStaffOpen((s) => ({ ...s, cases: e.currentTarget.open }))}>
          <summary className="cursor-pointer font-medium">Hackathon test cases T1–T5 (technical)</summary>
          <div className="mt-3">{staffOpen.cases && <ChallengeCases />}</div>
        </details>
      </section>
      <Disclaimer asOf={asOf} />
    </div>
  );
}
