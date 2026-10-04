import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { askAssistant, getInsights, getMyCredits, requestCredits, type AssistantCard, type AssistantReply, type InsightsReply } from "@/lib/assistant.functions";
import type { Insight, InsightLink } from "@/lib/engine/insights";
import { useAsOf } from "@/hooks/useAsOf";
import { Pill, RichText, TONE_COLOR } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tone } from "@/lib/engine/plain";
import { DEMO } from "@/lib/demo";
import { FREE_CREDITS } from "@/lib/credits";

type Turn = {
  id: number; question: string;
  /** Engine results as actionable points: instant, free, no AI. */ insights?: InsightsReply;
  /** Plain-language AI summary: arrives later, uses one credit. */ reply?: Extract<AssistantReply, { ok: true }>;
  writing?: boolean; error?: string; blocked?: boolean;
};

// The conversation lives outside the component so it survives moving between pages.
let turns: Turn[] = [];
const listeners = new Set<() => void>();
const setTurns = (next: Turn[]) => { turns = next; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const EMPTY: Turn[] = [];
/** Clears the conversation, e.g. on sign-out so the next account does not see it. */
export function resetAssistant() { setTurns([]); }

const EXAMPLES = [
  "What rental rules apply at 3438 McKinley Ave, Los Angeles?",
  "What is changing for renters in New Jersey, and when?",
  "Compare 6238 De Longpre Ave and 134 Oxford St",
  "Which rent increase rules exist in Berkeley?",
];
const KIND: Record<string, { label: string; tone: Tone }> = {
  upcoming: { label: "Starts later", tone: "future" }, proposed: { label: "Proposed", tone: "pending" },
  recent: { label: "Recently started", tone: "applies" }, struck: { label: "Struck down", tone: "superseded" }, expired: { label: "No longer current", tone: "superseded" },
};

export function useCredits() {
  const fn = useServerFn(getMyCredits);
  return useQuery({
    queryKey: ["credits"], throwOnError: false, retry: false, staleTime: 30_000,
    // Local demo mode has no account, so it shows the starting balance instead of asking the server.
    queryFn: () => (DEMO ? Promise.resolve({ balance: { unlimited: false, free: FREE_CREDITS, granted: 0, used: 0, remaining: FREE_CREDITS, requested: false }, recent: [] as Array<{ question: string; created_at: string }> }) : fn()),
  });
}

export function creditLine(b: { unlimited: boolean; remaining: number | null } | undefined) {
  if (!b) return "";
  if (b.unlimited) return "Unlimited AI summaries (staff)";
  return `${b.remaining ?? 0} free AI summar${b.remaining === 1 ? "y" : "ies"} left`;
}

function Action({ link }: { link: InsightLink }) {
  const cls = "inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline";
  const inner = <>{link.label} <ArrowRight className="h-3.5 w-3.5" /></>;
  switch (link.kind) {
    case "property": return <Link to="/property/$addressId" params={{ addressId: link.addressId }} className={cls}>{inner}</Link>;
    case "rule": return <Link to="/rules/$id" params={{ id: link.id }} className={cls}>{inner}</Link>;
    case "map": return <Link to="/map" search={{ ...(link.address ? { address: link.address } : {}), ...(link.layer ? { layer: link.layer } : {}) }} className={cls}>{inner}</Link>;
    case "changes": return <Link to="/changes" className={cls}>{inner}</Link>;
    case "list": return <Link to="/renter" search={link.q ? { q: link.q } : {}} className={cls}>{inner}</Link>;
  }
}

function InsightRow({ i }: { i: Insight }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_COLOR[i.tone], opacity: i.tone === "none" ? 0.5 : 1 }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{i.title}</div>
        {i.detail && <p className="mt-0.5 text-sm text-muted-foreground">{i.detail}</p>}
        {i.link && <div className="mt-1"><Action link={i.link} /></div>}
      </div>
    </li>
  );
}

function Card({ c }: { c: AssistantCard }) {
  if (c.type === "property") {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-medium text-foreground">{c.street}</div>
            <div className="text-xs text-muted-foreground">{c.place} · {c.legal_city ? `legal city ${c.legal_city}` : "legal city not confirmed yet"}</div>
          </div>
          <Link to="/property/$addressId" params={{ addressId: c.address_id }} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Full report <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {c.categories.map((x) => <li key={x.category} className="flex items-center justify-between gap-2 text-sm"><span>{x.label}</span><Pill tone={x.tone as Tone}>{x.headline}</Pill></li>)}
        </ul>
      </div>
    );
  }
  if (c.type === "change") {
    const k = KIND[c.kind] ?? { label: c.kind, tone: "none" as Tone };
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={k.tone}>{k.label}{c.effective_date ? ` · ${c.effective_date}` : ""}</Pill><span className="text-xs text-muted-foreground">{c.jurisdiction}</span></div>
        <Link to="/rules/$id" params={{ id: c.rule_id }} className="mt-1.5 block font-medium text-foreground hover:underline">{c.title}</Link>
        {c.key_value && <div className="text-sm text-muted-foreground">{c.key_value}</div>}
        <div className="mt-1 text-xs text-muted-foreground">{c.in_area} sample addresses in its area{c.maybe ? ` · ${c.maybe} more with city not confirmed` : ""}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <Link to="/rules/$id" params={{ id: c.rule_id }} className="text-sm font-medium text-foreground hover:underline">{c.title}</Link>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{c.status}</span>
      </div>
      <div className="text-xs text-muted-foreground">{c.jurisdiction}{c.key_value ? ` · ${c.key_value}` : ""}</div>
    </div>
  );
}

/**
 * One box: type an address, a city or a law. The engine's answer appears at once as actionable points (free); a
 * plain-language AI summary follows when the account has credits. `initialQuestion` runs once, for shared links.
 */
export function Assistant({ initialQuestion, onInitialQuestionUsed }: { initialQuestion?: string | undefined; onInitialQuestionUsed?: (() => void) | undefined }) {
  const [asOf] = useAsOf();
  const list = useSyncExternalStore(subscribe, () => turns, () => EMPTY);
  const insightsFn = useServerFn(getInsights), ask = useServerFn(askAssistant), request = useServerFn(requestCredits);
  const credits = useCredits();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const balance = credits.data?.balance;
  const out = !!balance && !balance.unlimited && (balance.remaining ?? 0) <= 0;
  const requestMore = async () => {
    try { const r = await request({ data: {} }); toast.success(r.already ? "Your request is already with the team." : "Request sent to the team."); void qc.invalidateQueries({ queryKey: ["credits"] }); }
    catch (e) { toast.error((e as Error).message); }
  };

  useEffect(() => { if (list.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [list]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const id = Date.now();
    const wantsSummary = !DEMO && !out;
    setTurns([...turns, { id, question: q, writing: wantsSummary }]);
    setText(""); setBusy(true);
    const patch = (t: Partial<Turn>) => setTurns(turns.map((x) => (x.id === id ? { ...x, ...t } : x)));
    const summary = wantsSummary ? ask({ data: { question: q, asOf } }).then((r) => ({ r, e: null as string | null }), (e: Error) => ({ r: null, e: e.message })) : null;
    try { patch({ insights: await insightsFn({ data: { question: q, asOf } }) }); }
    catch (e) { patch({ error: (e as Error).message }); }
    setBusy(false);
    if (summary) {
      const { r } = await summary;
      if (r?.ok) { patch({ reply: r, writing: false }); qc.setQueryData(["credits"], (old: { balance: unknown; recent: unknown } | undefined) => (old ? { ...old, balance: r.balance } : old)); }
      else patch({ writing: false, ...(r && !r.ok ? { blocked: true } : {}) });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    }
  }

  // A shared link such as /dashboard?ask=... runs its question once.
  const ran = useRef(false);
  useEffect(() => {
    if (!initialQuestion || ran.current) return;
    ran.current = true;
    if (!turns.some((t) => t.question === initialQuestion.trim())) void send(initialQuestion);
    onInitialQuestionUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <section className="space-y-5 print:hidden">
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-primary">
        <Search className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} aria-label="Your question"
          placeholder="An address, a city, or a law — for example “134 Oxford St, Cambridge”" className="h-12 flex-1 border-0 bg-transparent text-base shadow-none focus-visible:ring-0" />
        <Button type="submit" disabled={busy || text.trim().length < 3} className="h-12 px-6 text-base">{busy ? "Looking…" : "Get answers"}</Button>
      </form>

      {list.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Try:</span>
          {EXAMPLES.map((e) => <button key={e} type="button" disabled={busy} onClick={() => send(e)} className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50">{e}</button>)}
        </div>
      )}

      {list.map((t) => {
        const cards = t.reply?.cards.length ? t.reply.cards : t.insights?.cards ?? [];
        return (
          <article key={t.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header className="border-b border-border bg-muted/40 px-5 py-3">
              <div className="text-xs text-muted-foreground">You asked</div>
              <div className="font-medium text-foreground">{t.question}</div>
            </header>
            <div className="space-y-4 p-5">
              {!t.insights && !t.error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 animate-pulse" />Looking through the rules…</div>}
              {t.error && !t.reply && <div role="alert" className="rounded-md border border-destructive/40 bg-st-conflict-bg p-3 text-sm">Sorry, that didn't work: {t.error}</div>}
              {t.insights && (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-serif text-xl text-ink">{t.insights.headline}</h3>
                    <span className="text-xs text-muted-foreground">as of {t.insights.as_of}</span>
                  </div>
                  <ul className="mt-1 divide-y divide-border">{t.insights.insights.map((i, k) => <InsightRow key={k} i={i} />)}</ul>
                </div>
              )}
              {t.writing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 animate-pulse" />Writing a plain-language summary…</div>}
              {t.reply && (
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="h-3.5 w-3.5" />In plain words{t.reply.charged ? " · 1 credit used" : ""}</div>
                  <RichText text={t.reply.answer} />
                </div>
              )}
              {t.blocked && <OutOfCredits onRequest={requestMore} requested={!!balance?.requested} />}
              {cards.length > 0 && <div className="grid gap-2 md:grid-cols-2">{cards.map((c, i) => <Card key={i} c={c} />)}</div>}
              {!!t.reply?.follow_ups.length && <div className="flex flex-wrap gap-2">{t.reply.follow_ups.map((f) => <button key={f} type="button" disabled={busy} onClick={() => send(f)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground">{f}</button>)}</div>}
            </div>
          </article>
        );
      })}
      <div ref={end} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Answers come from the rules engine and the supplied legal texts. Not legal advice.</span>
        <span className="flex items-center gap-3">
          {credits.isError ? <span>Credit balance unavailable</span> : <span>{DEMO ? "Demo mode: AI summaries are off" : creditLine(balance)}</span>}
          {out && !balance?.requested && <button type="button" className="underline" onClick={requestMore}>Request more</button>}
          {list.length > 0 && <button type="button" className="underline" onClick={() => setTurns([])}>Clear</button>}
        </span>
      </div>
    </section>
  );
}

function OutOfCredits({ onRequest, requested }: { onRequest: () => void; requested: boolean }) {
  return (
    <div className="rounded-md border border-st-unknown/30 bg-st-unknown-bg/60 p-4 text-sm">
      <div className="font-medium text-foreground">You've used your free AI summaries.</div>
      <p className="mt-1 text-muted-foreground">The answers above, reports, law changes and the map stay free. Plain-language AI summaries come with a credit pack for people who ask often, such as property managers.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onRequest} disabled={requested}>{requested ? "Request sent" : "Request more credits"}</Button>
        <Button size="sm" variant="outline" asChild><Link to="/account">See plans in your account</Link></Button>
      </div>
    </div>
  );
}
