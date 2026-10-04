import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getOverview } from "@/lib/engine.functions";
import { Disclaimer, Stat } from "@/components/app/ui";

const overviewQ = queryOptions({ queryKey: ["overview"], queryFn: () => getOverview() });

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Housing Law Navigator — rental rules by property, with citations" },
      { name: "description", content: "What rental-housing rules apply to a property on a date, why, what is uncertain, and which sample properties a law change would affect." },
      { property: "og:title", content: "Housing Law Navigator" },
      { property: "og:description", content: "Cited, date-aware rental-housing rule applicability across a 500-property sample in CA, NJ and MA." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQ),
  component: Home,
});

const WORKSPACES = [
  { to: "/renter" as const, n: "I", title: "Renter", body: "Look up protections at an address, see missing facts and citations, and compare up to three properties by category." },
  { to: "/manager" as const, n: "II", title: "Property manager", body: "Inspect the sample portfolio's obligations and unresolved facts, review change impact, and export reports." },
  { to: "/reviewer" as const, n: "III", title: "Legal / policy reviewer", body: "Read source text, review extracted rules with exact quotes, record interactions, and explore labeled scenarios." },
];

function Home() {
  const { data } = useSuspenseQuery(overviewQ);
  const c = data.counts;
  return (
    <div className="space-y-10">
      <section className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div>
          <div className="eyebrow mb-3">Challenge 02 · Rental Housing Law Intelligence</div>
          <h1 className="font-serif text-5xl leading-[1.05] text-ink md:text-6xl">
            What applies here, <em>why</em>, and what is still unknown?
          </h1>
          <p className="mt-5 max-w-xl text-muted-foreground">
            One legal source → an automatically extracted rule with an exact quote → a cited property explanation → portfolio impact → a separately labeled hypothetical change.
          </p>
        </div>
        <Disclaimer />
      </section>

      {!data.dataset ? (
        <div className="paper rounded-sm p-6">
          <h2 className="text-2xl">No dataset imported yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">An admin needs to upload <span className="font-mono">housing_law_bootstrap.json</span> through the importer. Nothing is seeded by hand.</p>
          <Link to="/admin" className="mt-4 inline-block rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">Open admin importer</Link>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Sample properties" value={c!.properties} hint="CA 250 · NJ 140 · MA 110" />
          <Stat label="Source references" value={c!.sources} hint={`${c!.captured} with captured text`} />
          <Stat label="Extracted rules" value={c!.rules} hint={`${c!.reviewed} reviewed · ${c!.invalid} invalid`} />
          <Stat label="Jurisdiction resolved" value={`${c!.resolved}/${c!.properties}`} hint={`${c!.properties - c!.resolved} unresolved`} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {WORKSPACES.map((w) => (
          <Link key={w.to} to={w.to} className="paper group rounded-sm p-6 transition-transform hover:-translate-y-0.5">
            <div className="font-serif text-4xl italic text-primary">{w.n}</div>
            <h2 className="mt-3 text-2xl text-ink">{w.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{w.body}</p>
            <div className="mt-4 text-sm text-primary group-hover:underline">Open workspace →</div>
          </Link>
        ))}
      </section>
    </div>
  );
}
