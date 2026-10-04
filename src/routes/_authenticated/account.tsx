import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestCredits } from "@/lib/assistant.functions";
import { FREE_CREDITS } from "@/lib/credits";
import { useAuth } from "@/hooks/useAuth";
import { creditLine, resetAssistant, useCredits } from "@/components/app/Assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Account — Housing Law Navigator" },
      { name: "description", content: "Your profile, plan, assistant credits and password." },
      { property: "og:title", content: "Account — Housing Law Navigator" },
      { property: "og:description", content: "Profile, plan and credits." },
    ],
  }),
  component: Account,
});

const PLANS = [
  { name: "Free", who: "For a renter checking one or two homes", price: "No charge", points: [`${FREE_CREDITS} plain-language AI summaries`, "Unlimited answers, look-ups and reports", "Law changes and the map"] },
  { name: "Manager credits", who: "For property managers who ask often", price: "Credit pack, on request", points: ["AI summaries on demand", "Side-by-side comparisons and exports", "Credits are added to this account by the team"] },
];

function Account() {
  const { session, roles, isStaff } = useAuth();
  const credits = useCredits();
  const request = useServerFn(requestCredits);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pw, setPw] = useState({ a: "", b: "" });
  const [busy, setBusy] = useState(false);
  const user = session?.user;
  const providers = (user?.app_metadata?.["providers"] as string[] | undefined) ?? (user?.app_metadata?.["provider"] ? [String(user.app_metadata["provider"])] : []);
  const hasPassword = providers.includes("email");
  const b = credits.data?.balance;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.a.length < 8) { toast.error("Use at least 8 characters."); return; }
    if (pw.a !== pw.b) { toast.error("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPw({ a: "", b: "" });
    toast.success("Password updated.");
  }
  async function signOut() {
    await qc.cancelQueries(); qc.clear(); resetAssistant();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl text-ink md:text-4xl">Account</h1>
        <p className="mt-2 text-muted-foreground">Your profile, plan and assistant credits.</p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-serif text-xl text-ink">Profile</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Email</dt><dd className="font-medium">{user?.email ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Signs in with</dt><dd className="font-medium">{providers.length ? providers.map((p) => (p === "email" ? "Email and password" : p[0]!.toUpperCase() + p.slice(1))).join(", ") : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Member since</dt><dd className="font-medium">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Access</dt><dd className="font-medium">{roles.includes("admin") ? "Admin" : roles.includes("reviewer") ? "Reviewer" : "Standard"}</dd></div>
        </dl>
        {!isStaff && <p className="mt-3 text-xs text-muted-foreground">Reviewer and admin access is given by an existing admin. It can't be switched on from here.</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl text-ink">Plan and credits</h2>
          {credits.isError ? <span className="text-sm text-muted-foreground">Balance unavailable right now</span> : <span className="text-sm font-medium">{creditLine(b)}</span>}
        </div>
        {b && !b.unlimited && (
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground">Free</div><div className="font-serif text-2xl text-ink">{b.free}</div></div>
            <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground">Added</div><div className="font-serif text-2xl text-ink">{b.granted}</div></div>
            <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground">Used</div><div className="font-serif text-2xl text-ink">{b.used}</div></div>
          </div>
        )}
        <p className="mt-3 text-sm text-muted-foreground">One credit is one plain-language AI summary. The answers themselves, address look-ups, reports, law changes and the map never use credits.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PLANS.map((p, i) => (
            <div key={p.name} className={`rounded-md border p-4 ${i === 0 && !b?.granted ? "border-primary" : "border-border"}`}>
              <div className="flex items-baseline justify-between"><span className="font-medium">{p.name}</span><span className="text-xs text-muted-foreground">{p.price}</span></div>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.who}</p>
              <ul className="mt-3 space-y-1.5 text-sm">{p.points.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}</ul>
              {i === 1 && !b?.unlimited && <Button size="sm" className="mt-4" disabled={!!b?.requested} onClick={async () => { try { const r = await request({ data: {} }); toast.success(r.already ? "Your request is already with the team." : "Request sent. An admin will add credits to this account."); void qc.invalidateQueries({ queryKey: ["credits"] }); } catch (e) { toast.error((e as Error).message); } }}>{b?.requested ? "Request sent" : "Request credits"}</Button>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">There is no online payment in this prototype. Credit packs are added by the team after a request.</p>
        {!!credits.data?.recent.length && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-sm font-medium">Recent questions</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{credits.data.recent.map((r, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{r.question}</span><span className="shrink-0 text-xs">{new Date(r.created_at).toLocaleDateString()}</span></li>)}</ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-serif text-xl text-ink">Password</h2>
        <p className="mt-1 text-sm text-muted-foreground">{hasPassword ? "Choose a new password for this account." : "You sign in with Google. You can add a password here to also sign in with your email."}</p>
        <form onSubmit={changePassword} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="password" autoComplete="new-password" minLength={8} placeholder="New password (8+ characters)" aria-label="New password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
          <Input type="password" autoComplete="new-password" minLength={8} placeholder="Repeat new password" aria-label="Repeat new password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
          <Button type="submit" disabled={busy || !pw.a || !pw.b}>Save password</Button>
        </form>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-5">
        <div className="text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{user?.email}</span>. <Link to="/dashboard" className="underline">Back to Ask</Link></div>
        <Button variant="outline" onClick={signOut}>Sign out</Button>
      </section>
    </div>
  );
}
