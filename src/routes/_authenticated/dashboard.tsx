import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { getOverview } from "@/lib/engine.functions";
import { PageHeader, Stat } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Housing Law Navigator" },
      { name: "description", content: "Your overview of rental-housing rules, properties and pending reviews." },
      { property: "og:title", content: "Dashboard — Housing Law Navigator" },
      { property: "og:description", content: "Overview of rules, properties and reviews." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { isStaff } = useAuth();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => getOverview() });
  const c = q.data?.counts;
  const [addr, setAddr] = useState("");
  const nav = useNavigate();
  const empty = c && c.properties === 0;
  const cards = [
    { to: "/renter" as const, t: "Look up an address", b: "See which protections apply, why, and what's still unknown." },
    { to: "/manager" as const, t: "Review your portfolio", b: "Obligations and open questions across all properties." },
    { to: "/changes" as const, t: "See what a law change affects", b: "Before/after comparison and affected properties." },
  ];
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Overview" title="Welcome back" />
      <form onSubmit={(e) => { e.preventDefault(); nav({ to: "/renter", search: addr ? { q: addr } : {} }); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Search an address…" className="h-11 pl-9" />
        </div>
        <Button type="submit" className="h-11">Search</Button>
      </form>
      {q.isLoading && <p className="text-sm text-muted-foreground">Checking system readiness…</p>}
      {q.isError && <div className="rounded-md border border-destructive/40 p-4 text-sm">Couldn't load the overview. <button className="underline" onClick={() => q.refetch()}>Retry</button></div>}
      {q.data && <Readiness counts={c ?? null} isStaff={isStaff} />}
      {empty && null}
      {c && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Properties" value={c.properties} />
        <Stat label="Legal sources" value={c.sources} hint={`${c.captured} with text`} />
        <Stat label="Rules" value={c.rules} hint={`${c.invalid} invalid`} />
        <Stat label="Addresses placed" value={c.resolved} />
      </div>}
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((x) => (
          <Link key={x.to} to={x.to} className="group rounded-md border border-border bg-card p-5 transition-colors hover:border-primary">
            <div className="font-medium text-foreground">{x.t}</div>
            <p className="mt-1 text-sm text-muted-foreground">{x.b}</p>
            <ArrowRight className="mt-4 h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>
    </div>
  );
}

type Counts = { properties: number; sources: number; captured: number; rules: number; reviewed: number; invalid: number; geocoded: number; resolved: number };

function Readiness({ counts, isStaff }: { counts: Counts | null; isStaff: boolean }) {
  const steps = [
    { label: "Dataset imported", ok: !!counts && counts.properties > 0, detail: counts ? `${counts.properties} addresses, ${counts.sources} sources (${counts.captured} with text)` : "No active dataset" },
    { label: "Rules read from legal texts", ok: !!counts && counts.rules > 0, detail: counts ? `${counts.rules} rules${counts.invalid ? `, ${counts.invalid} rejected` : ""}` : "—" },
    { label: "Addresses placed in cities", ok: !!counts && counts.properties > 0 && counts.geocoded >= counts.properties, detail: counts ? `${counts.geocoded} of ${counts.properties} checked, ${counts.resolved} placed` : "—" },
    { label: "Rules reviewed by a person", ok: !!counts && counts.reviewed > 0, detail: counts ? `${counts.reviewed} reviewed` : "—" },
  ];
  const next = steps.find((s) => !s.ok);
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-medium">System readiness</div>
        <span className={next ? "text-sm text-st-unknown" : "text-sm text-primary"}>{next ? "Preparing" : "Ready"}</span>
      </div>
      <ol className="space-y-2 text-sm">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2">
            <span className={s.ok ? "text-primary" : "text-muted-foreground"}>{s.ok ? "✓" : "○"}</span>
            <span className="flex-1">{s.label}<span className="block text-xs text-muted-foreground">{s.detail}</span></span>
          </li>
        ))}
      </ol>
      {next && (
        <p className="mt-4 text-sm">
          {isStaff
            ? <>Next step: <Link to="/admin" className="font-medium underline">{next.label.toLowerCase()} on Data &amp; jobs</Link></>
            : "The legal data is still being prepared. Results may show as unknown until preparation finishes."}
        </p>
      )}
    </div>
  );
}
