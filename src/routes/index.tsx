import { createFileRoute, Link } from "@tanstack/react-router";
import { Home as HomeIcon, Building2, Scale, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISCLAIMER } from "@/lib/engine/applicability";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Housing Law Navigator — know which rental rules apply to any property" },
      { name: "description", content: "Rental housing law is scattered across state and city codes. See which rules apply to a property, why, and what changes when the law does." },
      { property: "og:title", content: "Housing Law Navigator" },
      { property: "og:description", content: "Which rental rules apply to a property, with the exact legal quote behind every answer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const AUDIENCES = [
  { icon: HomeIcon, t: "Renters", b: "Find out what protects you at your address — rent caps, eviction rules, deposits — in plain language with the source quoted." },
  { icon: Building2, t: "Property managers", b: "See obligations across every property you manage, what's still unclear, and which buildings a new law will touch." },
  { icon: Scale, t: "Legal & policy reviewers", b: "Check every rule against its source text, resolve conflicts between state and city law, and test hypothetical changes." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-serif text-xl text-ink">Housing Law <em>Navigator</em></span>
        <div className="flex items-center gap-3">
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
          <Button asChild size="sm"><Link to="/auth">Get started</Link></Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
        <h1 className="font-serif text-5xl leading-tight text-ink md:text-6xl">Know exactly which rental rules apply — and <em>why</em>.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">Enter an address. Get every applicable housing rule, the exact legal text behind it, and an honest flag where the answer is still uncertain.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild size="lg"><Link to="/auth">Get started</Link></Button>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2">
          <div>
            <div className="eyebrow mb-3">The problem</div>
            <h2 className="font-serif text-3xl text-ink">Housing law is scattered and constantly changing.</h2>
          </div>
          <ul className="space-y-4 text-muted-foreground">
            {["Rules are split across state statutes and dozens of city ordinances that can contradict each other.",
              "Whether a rule applies depends on the building — its age, unit count, use — and the date.",
              "When a law changes, nobody can easily say which properties are affected."].map((t) => (
              <li key={t} className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-primary" />{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="eyebrow mb-3 text-center">Who it's for</div>
        <h2 className="mb-10 text-center font-serif text-3xl text-ink">Built for everyone in the rental picture</h2>
        <div className="grid gap-5 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, t, b }) => (
            <div key={t} className="rounded-md border border-border bg-card p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-lg font-medium text-foreground">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-14 text-center">
          <h2 className="font-serif text-3xl text-primary-foreground">Start with your first address.</h2>
          <Button asChild size="lg" variant="secondary"><Link to="/auth">Create a free account</Link></Button>
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">{DISCLAIMER} Covers a 500-property sample in CA, NJ and MA.</footer>
    </div>
  );
}
