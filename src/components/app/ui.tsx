import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DISCLAIMER, DEFAULT_AS_OF } from "@/lib/engine/applicability";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { LIFECYCLE_LABEL, RESULT_LABEL, RESULT_TONE, type Tone } from "@/lib/engine/plain";

const STATUS_STYLE: Record<string, string> = {
  applies: "bg-st-applies-bg text-st-applies border-st-applies/30",
  unknown: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  not_yet_effective: "bg-st-future-bg text-st-future border-st-future/30",
  future: "bg-st-future-bg text-st-future border-st-future/30",
  pending: "bg-st-pending-bg text-st-pending border-st-pending/30",
  superseded: "bg-st-superseded-bg text-st-superseded border-st-superseded/30",
  failed: "bg-st-superseded-bg text-st-superseded border-st-superseded/30",
  repealed: "bg-st-superseded-bg text-st-superseded border-st-superseded/30",
  in_force: "bg-st-applies-bg text-st-applies border-st-applies/30",
  conflict: "bg-st-conflict-bg text-st-conflict border-st-conflict/30",
  invalid: "bg-st-conflict-bg text-st-conflict border-st-conflict/30",
  reviewed: "bg-st-applies-bg text-st-applies border-st-applies/30",
  validated_auto: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  resolved: "bg-st-applies-bg text-st-applies border-st-applies/30",
  no_match: "bg-st-conflict-bg text-st-conflict border-st-conflict/30",
  ambiguous: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  error: "bg-st-conflict-bg text-st-conflict border-st-conflict/30",
  none: "bg-muted text-muted-foreground border-border",
  captured: "bg-st-applies-bg text-st-applies border-st-applies/30",
  missing_text: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  evaluated: "bg-st-future-bg text-st-future border-st-future/30",
  partial: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  incomplete: "bg-muted text-muted-foreground border-border",
  passed: "bg-st-applies-bg text-st-applies border-st-applies/30",
  unresolved: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  hypothetical: "bg-st-pending-bg text-st-pending border-st-pending/30",
};
const STATUS_LABEL: Record<string, string> = {
  not_yet_effective: "not yet effective", validated_auto: "auto-validated, unreviewed", in_force: "in force", no_match: "no match",
  missing_text: "text missing", evaluated: "diagnostic run", hypothetical: "hypothetical — not law",
};
/** Vocabulary family: legal status of a rule, operational job state, or human review state. */
export type StatusKind = "legal" | "job" | "review";
const KIND_PREFIX: Record<StatusKind, string> = { legal: "", job: "job: ", review: "review: " };

export function Status({ value, className, kind }: { value: string | null | undefined; className?: string; kind?: StatusKind }) {
  const v = value ?? "none";
  return (
    <span className={cn("inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[0.68rem] uppercase tracking-wider whitespace-nowrap", STATUS_STYLE[v] ?? STATUS_STYLE["none"], className)}>
      {value ? (kind ? KIND_PREFIX[kind] : "") + (STATUS_LABEL[v] ?? v.replace(/_/g, " ")) : "—"}
    </span>
  );
}

export const TONE_CLASS: Record<Tone, string> = {
  applies: "bg-st-applies-bg text-st-applies border-st-applies/30",
  unknown: "bg-st-unknown-bg text-st-unknown border-st-unknown/30",
  future: "bg-st-future-bg text-st-future border-st-future/30",
  pending: "bg-st-pending-bg text-st-pending border-st-pending/30",
  superseded: "bg-st-superseded-bg text-st-superseded border-st-superseded/30",
  none: "bg-muted text-muted-foreground border-border",
};
export const TONE_COLOR: Record<Tone, string> = {
  applies: "var(--st-applies)", unknown: "var(--st-unknown)", future: "var(--st-future)", pending: "var(--st-pending)",
  superseded: "var(--st-superseded)", none: "var(--muted-foreground)",
};

/** Sentence-case pill for anything a normal user reads. */
export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string | undefined }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone], className)}>{children}</span>;
}

/** Engine result in plain words: Applies / May apply / Starts later / Proposed. */
export function ResultBadge({ value, className }: { value: string | null | undefined; className?: string | undefined }) {
  return <Pill tone={value ? RESULT_TONE[value] ?? "none" : "none"} className={className}>{value ? RESULT_LABEL[value] ?? value.replace(/_/g, " ") : "No rule found"}</Pill>;
}

const LIFECYCLE_TONE: Record<string, Tone> = { in_force: "applies", future: "future", pending: "pending", failed: "superseded", repealed: "superseded", unknown: "unknown" };
export function LifecycleBadge({ value }: { value: string }) {
  return <Pill tone={LIFECYCLE_TONE[value] ?? "none"}>{LIFECYCLE_LABEL[value] ?? value}</Pill>;
}

/** Minimal formatter for assistant answers: paragraphs, "- " bullets, **bold**, and [D041] source links. */
export function RichText({ text }: { text: string }) {
  const inline = (s: string, key: string) => s.split(/(\*\*[^*]+\*\*|\[D\d{3}\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}-${i}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    const doc = part.match(/^\[(D\d{3})\]$/);
    if (doc) return <Link key={`${key}-${i}`} to="/sources/$docId" params={{ docId: doc[1]! }} className="mx-0.5 rounded-sm bg-muted px-1 font-mono text-[0.7rem] text-primary hover:underline">{doc[1]}</Link>;
    return <span key={`${key}-${i}`}>{part}</span>;
  });
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) { const items = bullets; blocks.push(<ul key={`u${blocks.length}`} className="ml-4 list-disc space-y-1">{items.map((b, i) => <li key={i}>{inline(b, `b${blocks.length}-${i}`)}</li>)}</ul>); bullets = []; } };
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (/^[-•*]\s+/.test(line)) bullets.push(line.replace(/^[-•*]\s+/, ""));
    else { flush(); if (line) blocks.push(<p key={`p${blocks.length}`}>{inline(line, `p${blocks.length}`)}</p>); }
  });
  flush();
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}

export function Disclaimer({ asOf = DEFAULT_AS_OF, extra }: { asOf?: string; extra?: ReactNode }) {
  return (
    <div className="border-l-2 border-st-unknown bg-st-unknown-bg/60 px-3 py-2 text-xs text-accent-foreground">
      <strong className="font-semibold">{DISCLAIMER}</strong>{" "}
      As of <span className="font-mono">{asOf}</span>. Results reflect only the supplied source snapshot (some references have no captured text) and automated extraction that may be unreviewed. {extra}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 border-b border-border pb-5">
      <div className="eyebrow mb-2">{eyebrow}</div>
      <h1 className="text-3xl font-medium text-ink md:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-sm text-muted-foreground">{children}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="paper rounded-sm px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-serif text-3xl text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const NAV = [
  { to: "/renter", label: "Renter" },
  { to: "/manager", label: "Manager" },
  { to: "/reviewer", label: "Reviewer" },
  { to: "/changes", label: "Changes" },
  { to: "/map", label: "Sample map" },
  { to: "/admin", label: "Admin" },
  { to: "/console", label: "Console" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { session, roles } = useAuth();
  return (
    <div className="min-h-screen">
      <div className="bg-ink py-1 text-center font-mono text-[0.68rem] tracking-wider text-primary-foreground">
        {DISCLAIMER.toUpperCase()}
      </div>
      <nav className="border-b border-border bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <Link to="/" className="font-serif text-xl text-ink">Housing Law <em>Navigator</em></Link>
          <div className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="text-muted-foreground hover:text-ink" activeProps={{ className: "text-ink underline underline-offset-4 decoration-primary" }}>{n.label}</Link>
            ))}
          </div>
          <div className="ml-auto text-xs">
            {session ? (
              <span className="flex items-center gap-3">
                <span className="text-muted-foreground">{session.user.email} · <span className="font-mono">{roles.join(", ") || "user"}</span></span>
                <button className="underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
              </span>
            ) : (
              <Link to="/auth" className="underline">Staff sign in</Link>
            )}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {DISCLAIMER} Sample of 500 supplied properties in CA, NJ and MA — not citywide coverage.
      </footer>
    </div>
  );
}

export function download(name: string, data: unknown) {
  const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
