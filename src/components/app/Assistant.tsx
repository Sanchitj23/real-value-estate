import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { askAssistant, getMyCredits, requestCredits, type AssistantCard, type AssistantReply } from "@/lib/assistant.functions";
import { useAsOf } from "@/hooks/useAsOf";
import { Pill, RichText } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Tone } from "@/lib/engine/plain";

type Turn = { id: number; question: string; reply?: Extract<AssistantReply, { ok: true }>; error?: string; blocked?: boolean };

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
  "Compare 6238 De Longpre Ave and 10050 Mountair Ave",
  "Which rent increase rules exist in Berkeley?",
];
const KIND: Record<string, { label: string; tone: Tone }> = {
  upcoming: { label: "Starts later", tone: "future" }, proposed: { label: "Proposed", tone: "pending" },
  recent: { label: "Recently started", tone: "applies" }, struck: { label: "Struck down", tone: "superseded" }, expired: { label: "No longer current", tone: "superseded" },
};

export function useCredits() {
  const fn = useServerFn(getMyCredits);
  return useQuery({ queryKey: ["credits"], queryFn: () => fn(), throwOnError: false, retry: false, staleTime: 30_000 });
}

export function creditLine(b: { unlimited: boolean; remaining: number | null } | undefined) {
  if (!b) return "";
  if (b.unlimited) return "Unlimited questions (staff)";
  return `${b.remaining ?? 0} free question${b.remaining === 1 ? "" : "s"} left`;
}

function Card({ c }: { c: AssistantCard }) {
  if (c.type === "property") {
    return (
      <div className="rounded-md border border-border bg-background p-4">
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
      <div className="rounded-md border border-border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={k.tone}>{k.label}{c.effective_date ? ` · ${c.effective_date}` : ""}</Pill><span className="text-xs text-muted-foreground">{c.jurisdiction}</span></div>
        <Link to="/rules/$id" params={{ id: c.rule_id }} className="mt-1.5 block font-medium text-foreground hover:underline">{c.title}</Link>
        {c.key_value && <div className="text-sm text-muted-foreground">{c.key_value}</div>}
        <div className="mt-1 text-xs text-muted-foreground">{c.in_area} sample addresses in its area{c.maybe ? ` · ${c.maybe} more with city not confirmed` : ""}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <Link to="/rules/$id" params={{ id: c.rule_id }} className="text-sm font-medium text-foreground hover:underline">{c.title}</Link>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{c.status}</span>
      </div>
      <div className="text-xs text-muted-foreground">{c.jurisdiction}{c.key_value ? ` · ${c.key_value}` : ""}</div>
    </div>
  );
}

export function Assistant() {
  const [asOf] = useAsOf();
  const list = useSyncExternalStore(subscribe, () => turns, () => EMPTY);
  const ask = useServerFn(askAssistant), request = useServerFn(requestCredits);
  const credits = useCredits();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const balance = credits.data?.balance;
  const out = !!balance && !balance.unlimited && (balance.remaining ?? 0) <= 0;

  useEffect(() => { if (list.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [list]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const id = Date.now();
    setTurns([...turns, { id, question: q }]);
    setText(""); setBusy(true);
    const patch = (t: Partial<Turn>) => setTurns(turns.map((x) => (x.id === id ? { ...x, ...t } : x)));
    try {
      const reply = await ask({ data: { question: q, asOf } });
      if (reply.ok) { patch({ reply }); qc.setQueryData(["credits"], (old: { balance: unknown; recent: unknown } | undefined) => (old ? { ...old, balance: reply.balance } : old)); }
      else patch({ blocked: true });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch (e) { patch({ error: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm print:hidden">
      <div className="space-y-4 p-5 md:p-6">
        {list.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => <button key={e} type="button" disabled={busy || out} onClick={() => send(e)} className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50">{e}</button>)}
          </div>
        )}
        {list.map((t) => (
          <div key={t.id} className="space-y-3">
            <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground">{t.question}</div>
            {!t.reply && !t.error && !t.blocked && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 animate-pulse" />Looking through the rules…</div>}
            {t.error && <div role="alert" className="rounded-md border border-destructive/40 bg-st-conflict-bg p-3 text-sm">Sorry, that didn't work: {t.error}</div>}
            {t.blocked && <OutOfCredits onRequest={async () => { try { const r = await request({ data: {} }); toast.success(r.already ? "Your request is already with the team." : "Request sent to the team."); void qc.invalidateQueries({ queryKey: ["credits"] }); } catch (e) { toast.error((e as Error).message); } }} requested={!!balance?.requested} />}
            {t.reply && (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background p-4"><RichText text={t.reply.answer} /></div>
                {t.reply.cards.length > 0 && <div className="grid gap-2 md:grid-cols-2">{t.reply.cards.map((c, i) => <Card key={i} c={c} />)}</div>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>As of {t.reply.as_of}</span>
                  {!t.reply.ai && <span>· Shown without AI wording; no credit used</span>}
                  {t.reply.charged && <span>· 1 credit used</span>}
                </div>
                {t.reply.follow_ups.length > 0 && <div className="flex flex-wrap gap-2">{t.reply.follow_ups.map((f) => <button key={f} type="button" disabled={busy} onClick={() => send(f)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground">{f}</button>)}</div>}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
        {out && !list.some((t) => t.blocked) && <OutOfCredits onRequest={async () => { try { const r = await request({ data: {} }); toast.success(r.already ? "Your request is already with the team." : "Request sent to the team."); void qc.invalidateQueries({ queryKey: ["credits"] }); } catch (e) { toast.error((e as Error).message); } }} requested={!!balance?.requested} />}
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-end gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} disabled={out} aria-label="Your question"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            placeholder="Ask about an address, a city or a law — for example “What protects a renter at 134 Oxford St, Cambridge?”" className="min-h-[3.25rem] resize-none bg-background" />
          <Button type="submit" disabled={busy || out || text.trim().length < 3} className="h-[3.25rem] px-4"><Send className="h-4 w-4" /><span className="sr-only">Ask</span></Button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Answers come from the rules engine and the supplied legal texts. Not legal advice.</span>
          <span className="flex items-center gap-3">
            {credits.isError ? <span>Credit balance unavailable</span> : <span className="font-medium text-foreground">{creditLine(balance)}</span>}
            {list.length > 0 && <button type="button" className="underline" onClick={() => setTurns([])}>Clear</button>}
          </span>
        </div>
      </div>
    </section>
  );
}

function OutOfCredits({ onRequest, requested }: { onRequest: () => void; requested: boolean }) {
  return (
    <div className="rounded-md border border-st-unknown/30 bg-st-unknown-bg/60 p-4 text-sm">
      <div className="font-medium text-foreground">You've used your free questions.</div>
      <p className="mt-1 text-muted-foreground">Looking up addresses, reports, law changes and the map stay free. More assistant questions come with a credit pack for people who use this often, such as property managers.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onRequest} disabled={requested}>{requested ? "Request sent" : "Request more credits"}</Button>
        <Button size="sm" variant="outline" asChild><Link to="/account">See plans in your account</Link></Button>
      </div>
    </div>
  );
}
