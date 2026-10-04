import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPropertyReport } from "@/lib/engine.functions";
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_AS_OF, factLabelOf } from "@/lib/engine/applicability";
import { Disclaimer, PageHeader, Status, download } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const reportQ = (addressId: string, asOf: string) =>
  queryOptions({ queryKey: ["report", addressId, asOf], queryFn: () => getPropertyReport({ data: { addressId, asOf } }) });

export const Route = createFileRoute("/property/$addressId")({
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
        { name: "description", content: "Cited rental-housing rule applicability, missing facts and source quotes for this sample property." },
        { property: "og:title", content: t },
        { property: "og:description", content: "Cited, date-aware rental rule applicability report." },
      ],
    };
  },
  notFoundComponent: () => <p>Property not found in the imported sample.</p>,
  component: PropertyReport,
});

function PropertyReport() {
  const { addressId } = Route.useParams();
  const [asOf, setAsOf] = useState(DEFAULT_AS_OF);
  const { data: r, isFetching } = useQuery({ ...reportQ(addressId, asOf), placeholderData: (p) => p });
  if (!r) return <p>Loading…</p>;
  const p = r.property;
  const allMissing = Array.from(new Set(r.outcomes.flatMap((o) => o.missing)));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Property report · ${p.address_id}`} title={p.street_address}>
        {p.postal_city} (postal), {p.state} {p.zip} · {p.use_description ?? "use unknown"} · built {p.year_built ?? "unknown"} · {p.units ?? "unknown"} units
      </PageHeader>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="eyebrow mb-1">As-of date</div>
          <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="w-44" />
        </label>
        <Button variant="outline" onClick={() => download(`report-${p.address_id}-${asOf}.json`, { disclaimer: "Not legal advice. Prototype using supplied public sources.", ...r })}>Export report (JSON)</Button>
        {isFetching && <span className="text-xs text-muted-foreground">Re-evaluating…</span>}
      </div>
      <Disclaimer asOf={r.asOf} />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="paper rounded-sm p-4 text-sm">
          <div className="eyebrow mb-2">Jurisdiction evidence</div>
          {r.resolution ? (
            <>
              <Status value={r.resolution.status} />
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-muted-foreground">Legal place: </dt><dd className="inline">{r.resolution.place_name ?? "—"} <span className="text-xs text-muted-foreground">({r.resolution.place_kind})</span></dd></div>
                <div><dt className="inline text-muted-foreground">County: </dt><dd className="inline">{r.resolution.county_name ?? "—"}</dd></div>
                <div><dt className="inline text-muted-foreground">Provider: </dt><dd className="inline">US Census Geocoder</dd></div>
              </dl>
            </>
          ) : <p className="text-muted-foreground">Not resolved. Local rules are reported as unknown; postal city is not used as legal jurisdiction.</p>}
        </div>
        <div className="paper rounded-sm p-4 text-sm md:col-span-2">
          <div className="eyebrow mb-2">What must be established before acting ({allMissing.length})</div>
          {allMissing.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">{allMissing.map((m) => <li key={m}>• {factLabelOf(m)}</li>)}</ul>
          ) : <p className="text-muted-foreground">No missing facts on the evaluated rules.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Missing facts are treated as unknown, never false. Year built is not a certificate-of-occupancy date.</p>
        </div>
      </section>

      {r.ruleCount === 0 && <p className="text-sm text-st-unknown">No extracted rules exist yet; nothing can be reported. Absence of a rule is “coverage not established”, not a legal negative.</p>}

      {CATEGORIES.map((cat) => {
        const outs = r.outcomes.filter((o) => o.category === cat && o.result);
        return (
          <section key={cat}>
            <h2 className="mb-2 flex items-center gap-3 text-2xl">{CATEGORY_LABEL[cat]} <Status value={r.summary.categories[cat]} /></h2>
            {outs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Coverage not established from the supplied, extracted sources.</p>
            ) : (
              <div className="space-y-3">
                {outs.map((o) => (
                  <article key={o.rule_id} className="paper rounded-sm p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Status value={o.result} />
                      <Status value={o.lifecycle} />
                      <Status value={o.review_state} />
                      {o.conflict_flag && <Status value="conflict" />}
                      <Link to="/rules/$id" params={{ id: o.rule_id }} className="font-serif text-lg text-ink hover:underline">{o.title}</Link>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{o.jurisdiction} · {o.citation}{o.key_value ? ` · ${o.key_value}` : ""}</div>
                    <p className="mt-2 text-sm">{o.requirement}</p>
                    <p className="mt-2 text-sm text-muted-foreground"><strong className="text-foreground">Why: </strong>{o.explanation}</p>
                    {o.conflict_note && <p className="mt-1 text-sm text-st-conflict">{o.conflict_note}</p>}
                    <blockquote className="mt-3 border-l-2 border-primary bg-muted/60 px-3 py-2 source-text">“{o.quoted_span}”</blockquote>
                    {o.source_doc_id && <Link to="/sources/$docId" params={{ docId: o.source_doc_id }} className="mt-1 inline-block text-xs text-primary underline">Source {o.source_doc_id}</Link>}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {r.notCurrent.length > 0 && (
        <section className="paper rounded-sm p-4 text-sm">
          <div className="eyebrow mb-2">Recorded but not current protections</div>
          <ul>{r.notCurrent.map((n, i) => <li key={i}><Status value={n.lifecycle} /> {n.title} — {n.jurisdiction} ({n.citation})</li>)}</ul>
        </section>
      )}
    </div>
  );
}
