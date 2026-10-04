import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, CalendarClock, Map, Search } from "lucide-react";
import { getOverview } from "@/lib/engine.functions";
import { Assistant } from "@/components/app/Assistant";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Ask — Housing Law Navigator" },
      { name: "description", content: "Ask which rental rules apply at a sample address, what is changing, and see the legal text behind every answer." },
      { property: "og:title", content: "Ask — Housing Law Navigator" },
      { property: "og:description", content: "Plain-language answers about rental rules, with sources." },
    ],
  }),
  // /dashboard?ask=... runs that question once, so an answer can be shared or opened straight from a link.
  validateSearch: (s: Record<string, unknown>): { ask?: string } => (typeof s["ask"] === "string" && s["ask"].trim() ? { ask: s["ask"].slice(0, 600) } : {}),
  component: Dashboard,
});

const STEPS = [
  { n: "1", t: "We read the law", b: "State and city rental laws are read from official texts. Every rule keeps the exact sentence it came from." },
  { n: "2", t: "We place the address", b: "The legal city is confirmed with the US Census, because a mailing city is not always the legal one." },
  { n: "3", t: "You get a straight answer", b: "Applies, may apply, starts later or proposed. When a fact is missing we say which one, instead of guessing." },
];

function Dashboard() {
  const { isStaff } = useAuth();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => getOverview(), throwOnError: false });
  const c = q.data?.counts;
  const [addr, setAddr] = useState("");
  const nav = useNavigate();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const cards = [
    { to: "/renter" as const, icon: Search, t: "Find a property", b: "Pick one of the 500 sample addresses and read its rules in plain words." },
    { to: "/changes" as const, icon: CalendarClock, t: "See what's changing", b: "New, upcoming and proposed laws, and which addresses each one reaches." },
    { to: "/map" as const, icon: Map, t: "Explore the map", b: "City outlines and addresses, coloured by the topic or law you choose." },
  ];
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl text-ink md:text-4xl">What do you want to know about a rental?</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Type an address, a city or a law. You get what applies, what to check, and what is about to change, each with the legal text behind it.</p>
      </header>

      <Assistant initialQuestion={search.ask} onInitialQuestionUsed={() => navigate({ search: {}, replace: true })} />

      <form onSubmit={(e) => { e.preventDefault(); nav({ to: "/renter", search: addr ? { q: addr } : {} }); }} className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Or browse the sample addresses:</span>
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Street, city, ZIP or sample ID" aria-label="Search an address" className="h-10 pl-9" />
        </div>
        <Button type="submit" variant="outline" className="h-10">Search</Button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(({ to, icon: Icon, t, b }) => (
          <Link key={to} to={to} className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary">
            <Icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-medium text-foreground">{t}</div>
            <p className="mt-1 text-sm text-muted-foreground">{b}</p>
            <ArrowRight className="mt-4 h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-5 md:p-6">
        <h2 className="font-serif text-xl text-ink">How it works</h2>
        <ol className="mt-4 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">{s.n}</span>
              <span><span className="block font-medium text-foreground">{s.t}</span><span className="mt-0.5 block text-sm text-muted-foreground">{s.b}</span></span>
            </li>
          ))}
        </ol>
        {c && <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
          Right now: {c.properties} sample addresses in California, New Jersey and Massachusetts · {c.rules} rules read from {c.captured} legal texts · {c.resolved} addresses with a confirmed legal city.
          {isStaff && <> <Link to="/admin" className="font-medium text-primary underline">Data status and jobs</Link></>}
        </p>}
      </section>
    </div>
  );
}
