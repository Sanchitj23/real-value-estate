import { useAsOf } from "@/hooks/useAsOf";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Download, MapPin, Printer } from "lucide-react";
import { getPropertyReport } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF, DISCLAIMER } from "@/lib/engine/applicability";
import { categorySummary, groupMissing, LIFECYCLE_LABEL, RESULT_HELP, sortOutcomes } from "@/lib/engine/plain";
import { Pill, ResultBadge, download } from "@/components/app/ui";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const reportQ = (addressId: string, asOf: string) =>
  queryOptions({ queryKey: ["report", addressId, asOf], queryFn: () => getPropertyReport({ data: { addressId, asOf } }) });

export const Route = createFileRoute("/_authenticated/property/$addressId")({
  loader: async ({ context, params }) => {
    const r = await context.queryClient.ensureQueryData(reportQ(params.addressId, DEFAULT_AS_OF));
    if (!r) throw notFound();
    return { street: r.property.street_address, city: r.property.postal_city, state: r.property.state };
  },
  head: ({ loaderData, params }) => {
    const t = loaderData ? `${loaderData.street}, ${loaderData.city} ${loaderData.state} — rental rules report` : `Property ${params.addressId}`;
    return {
      meta: [
        { title: t },
        { name: "description", content: "Rental rules that apply or may apply at this sample property, with what is still unknown and the legal text behind each rule." },
        { property: "og:title", content: t },
        { property: "og:description", content: "Plain-language rental rules report with sources." },
      ],
    };
  },
  notFoundComponent: () => <p>That address isn't in the 500-property sample. That doesn't mean no law applies there.</p>,
  component: PropertyReport,
});

type Report = NonNullable<Awaited<ReturnType<typeof getPropertyReport>>>;
type Outcome = Report["outcomes"][number];

function RuleRow({ o }: { o: Outcome }) {
  const need = groupMissing(o.missing);
  const toCheck = [...need.facts, ...need.checks];
  const why = o.explanation.split(" Missing: ")[0];
  return (
    <article className="rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 flex-1 font-sans text-base font-medium text-foreground">{o.title}</h3>
        <span className="flex items-center gap-1.5">{o.conflict_flag && <Pill tone="superseded" className="border-st-conflict/30 bg-st-conflict-bg text-st-conflict">Conflict flagged</Pill>}<ResultBadge value={o.result} /></span>
      </div>
      {o.key_value && <div className="mt-1 font-serif text-lg leading-snug text-ink">{o.key_value}</div>}
      <p className="mt-1 text-sm text-muted-foreground">{o.requirement}</p>
      {o.result === "unknown" && toCheck.length > 0 && (
        <p className="mt-2 text-sm"><span className="font-medium text-st-unknown">To be sure, check: </span>{toCheck.slice(0, 2).join(" · ")}{toCheck.length > 2 && <span className="text-muted-foreground"> · and {toCheck.length - 2} more</span>}</p>
      )}
      {o.conflict_note && <p className="mt-2 text-sm text-st-conflict">{o.conflict_note}</p>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-primary hover:underline">Why, and the legal text</summary>
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          <p className="text-muted-foreground">{why}</p>
          {toCheck.length > 2 && <ul className="ml-4 list-disc text-muted-foreground">{toCheck.slice(2).map((m) => <li key={m}>{m}</li>)}</ul>}
          {need.generic.map((g) => <p key={g} className="text-muted-foreground">{g}.</p>)}
          {o.quoted_span && <blockquote className="rounded-sm bg-muted/60 px-3 py-2 source-text">“{o.quoted_span}”</blockquote>}
          <p className="text-xs text-muted-foreground">
            {o.jurisdiction} · {o.citation} · {LIFECYCLE_LABEL[o.lifecycle] ?? o.lifecycle} · {o.review_state === "reviewed" ? "checked by a reviewer" : "read automatically, not yet checked by a person"}
            {o.retrieved_at && ` · source retrieved ${o.retrieved_at.slice(0, 10)}`}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {o.source_doc_id && <Link to="/sources/$docId" params={{ docId: o.source_doc_id }} className="text-primary underline">Stored source text ({o.source_doc_id})</Link>}
            {o.source_url && <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Official page</a>}
            <Link to="/rules/$id" params={{ id: o.rule_id }} className="text-primary underline">Rule details and history</Link>
          </p>
          {o.trace.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Condition check (technical)</summary><ul className="mt-1">{o.trace.map((t, i) => <li key={i}>{t.label}: {String(t.result)}</li>)}</ul></details>}
        </div>
      </details>
    </article>
  );
}

function CategorySection({ list }: { list: Outcome[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 3);
  return (
    <div className="space-y-3">
      {shown.map((o) => <RuleRow key={o.rule_id} o={o} />)}
      {list.length > 3 && <button className="text-sm font-medium text-primary underline print:hidden" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${list.length} rules`}</button>}
    </div>
  );
}

function PropertyReport() {
  const { addressId } = Route.useParams();
  const [asOf, setAsOf] = useAsOf();
  const { data: r, isFetching, error, refetch } = useQuery({ ...reportQ(addressId, asOf), throwOnError: false });
  if (error) return <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">The report couldn't be loaded ({error.message}). <button className="underline" onClick={() => refetch()}>Try again</button></div>;
  if (!r) return <p className="text-muted-foreground">Loading the report…</p>;
  const p = r.property;
  const outs = r.outcomes.filter((o) => o.result);
  const cats = CATEGORIES.map((cat) => { const list = sortOutcomes(outs.filter((o) => o.category === cat)); return { cat, list, summary: categorySummary(list.map((o) => o.result)) }; });
  const overall = categorySummary(outs.map((o) => o.result));
  const need = groupMissing(outs.flatMap((o) => o.missing));
  const placed = r.resolution?.status === "resolved";
  const legalCity = placed ? r.resolution?.place_name ?? "outside any incorporated city" : null;
  const firstOpen = cats.filter((c) => c.list.length).slice(0, 1).map((c) => c.cat);

  return (
    <div className="space-y-6">
      <Link to="/renter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="h-3.5 w-3.5" />All properties</Link>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="font-serif text-3xl text-ink md:text-4xl">{p.street_address}</h1>
          <p className="mt-1 text-muted-foreground">{p.postal_city}, {p.state} {p.zip} · {p.use_description ?? "use not recorded"} · {p.units ?? "unknown number of"} units · built {p.year_built ?? "year unknown"}</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {legalCity ? <span>Legal city: <strong className="font-medium">{legalCity}</strong>{r.resolution?.county_name ? `, ${r.resolution.county_name}` : ""} <span className="text-muted-foreground">(confirmed with the US Census)</span></span>
              : <span className="text-st-unknown">Legal city not confirmed yet. City rules are shown as “may apply”; the mailing city isn't used as proof.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="text-xs text-muted-foreground">Rules as of
            <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="mt-1 w-40" />
          </label>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
          <Button variant="outline" onClick={() => download(`report-${p.address_id}-${asOf}.json`, { disclaimer: DISCLAIMER, ...r })}><Download className="h-4 w-4" />Data</Button>
        </div>
      </header>

      <section aria-label="At a glance">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl text-ink">At a glance <span className="font-sans text-sm text-muted-foreground">· as of {r.asOf}{isFetching ? " · updating…" : ""}</span></h2>
          <p className="text-sm text-muted-foreground">{outs.length ? overall.parts.join(" · ") : "No rules to show yet"}</p>
        </div>
        {r.ruleCount === 0
          ? <p className="rounded-md border border-st-unknown/30 bg-st-unknown-bg/60 p-4 text-sm">The legal texts haven't been read yet, so there is nothing to report. This is a preparation step, not a sign that no law applies here.</p>
          : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cats.map(({ cat, list, summary }) => (
              <a key={cat} href={`#${cat}`} className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60">
                <div className="flex items-start justify-between gap-2"><span className="font-medium text-foreground">{CATEGORY_LABEL[cat]}</span><Pill tone={summary.tone}>{summary.headline}</Pill></div>
                <p className="mt-2 text-sm text-muted-foreground">{list.find((o) => o.key_value)?.key_value ?? list[0]?.title ?? "Nothing in the legal texts we have covers this topic here."}</p>
                {summary.parts.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{summary.parts.slice(1).join(" · ")}</p>}
              </a>
            ))}
          </div>}
      </section>

      {overall.tone !== "none" && (
        <section className="rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="font-sans text-sm font-medium text-foreground">How to read this</h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {(["applies", "unknown", "not_yet_effective", "pending"] as const).map((k) => <li key={k} className="flex items-start gap-2"><ResultBadge value={k} className="mt-0.5 shrink-0" /><span className="text-muted-foreground">{RESULT_HELP[k]}</span></li>)}
          </ul>
          {(need.facts.length > 0 || need.checks.length > 0) && (
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer font-medium text-foreground">What would settle the “may apply” answers ({need.facts.length + need.checks.length} points)</summary>
              {need.facts.length > 0 && <><p className="mt-2 text-muted-foreground">Facts about the property or tenancy we don't have:</p><ul className="ml-4 list-disc">{need.facts.map((m) => <li key={m}>{m}</li>)}</ul></>}
              {need.checks.length > 0 && <><p className="mt-2 text-muted-foreground">Conditions in the law that can't be checked from the data:</p><ul className="ml-4 list-disc text-muted-foreground">{need.checks.map((m) => <li key={m}>{m}</li>)}</ul></>}
              <p className="mt-2 text-xs text-muted-foreground">A missing fact is treated as unknown, never as “no”. The year a building was built is not its certificate-of-occupancy date.</p>
            </details>
          )}
        </section>
      )}

      {outs.length > 0 && (
        <Accordion type="multiple" defaultValue={firstOpen} className="rounded-lg border border-border bg-card px-4">
          {cats.map(({ cat, list, summary }) => (
            <AccordionItem key={cat} value={cat} id={cat} className="scroll-mt-20 last:border-b-0">
              <AccordionTrigger className="hover:no-underline">
                <span className="flex flex-1 flex-wrap items-center justify-between gap-2 pr-3"><span className="font-serif text-xl text-ink">{CATEGORY_LABEL[cat]}</span><Pill tone={summary.tone}>{summary.parts.join(" · ") || summary.headline}</Pill></span>
              </AccordionTrigger>
              <AccordionContent>
                {list.length ? <CategorySection list={list} /> : <p className="text-muted-foreground">Nothing in the legal texts we have covers this topic for this address. That is a gap in our sources, not a finding that no law exists.</p>}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {r.notCurrent.length > 0 && (
        <details className="rounded-lg border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">No longer current or struck down ({r.notCurrent.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">{r.notCurrent.map((n, i) => <li key={i}>{n.title} — {n.jurisdiction} · {LIFECYCLE_LABEL[n.lifecycle] ?? n.lifecycle}</li>)}</ul>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        {DISCLAIMER} As of {r.asOf}. Based only on the legal texts supplied to this prototype; some were not available, and most rules were read automatically and not yet checked by a person.
      </p>
    </div>
  );
}
