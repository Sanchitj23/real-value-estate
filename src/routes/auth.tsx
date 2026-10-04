import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { DISCLAIMER } from "@/lib/engine/applicability";
import { DEMO } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Housing Law Navigator" },
      { name: "description", content: "Sign in or create an account to look up rental rules for any property." },
      { property: "og:title", content: "Sign in — Housing Law Navigator" },
      { property: "og:description", content: "Access your Housing Law Navigator dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "in" | "up" | "reset";

function AuthPage() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    // A password-reset link signs the person in; send them to Account to choose the new password.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") nav({ to: "/account", replace: true }); });
    supabase.auth.getSession().then(({ data }) => { if (data.session || DEMO) nav({ to: "/dashboard", replace: true }); });
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/account" });
      if (error) toast.error(error.message); else setSent(true);
    } else if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message); else nav({ to: "/dashboard" });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/dashboard" } });
      if (error) toast.error(error.message);
      else if (!data.session) toast.success("Check your email to confirm your account.");
      else nav({ to: "/dashboard" });
    }
    setBusy(false);
  }

  const title = mode === "in" ? "Sign in" : mode === "up" ? "Create your account" : "Reset your password";
  const sub = mode === "in" ? "Welcome back." : mode === "up" ? "Free to start: unlimited answers and look-ups, and two AI summaries." : "We'll email you a link to choose a new password.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <Link to="/" className="mb-8 font-serif text-2xl text-ink">Housing Law <em>Navigator</em></Link>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div>
          <h1 className="font-sans text-xl font-medium text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        </div>
        {mode === "reset" && sent
          ? <p className="rounded-md bg-st-applies-bg p-3 text-sm text-st-applies">If an account exists for {email}, a reset link is on its way. Open it on this device.</p>
          : <>
            <Input type="email" required autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {mode !== "reset" && <Input type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="Password (8+ characters)" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            <Button type="submit" disabled={busy} className="w-full">{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</Button>
          </>}
        {mode === "in" && <button type="button" className="block w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode("reset"); setSent(false); }}>Forgot your password?</button>}
        {mode !== "reset" && <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <Button type="button" variant="outline" disabled={busy} className="w-full" onClick={async () => {
            const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
            if (result.error) { toast.error(result.error.message ?? "Google sign-in failed"); return; }
            if (result.redirected) return;
            nav({ to: "/dashboard" });
          }}>Continue with Google</Button>
        </>}
        <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode(mode === "in" ? "up" : "in"); setSent(false); }}>
          {mode === "in" ? "New here? Create an account" : "Back to sign in"}
        </button>
      </form>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">{DISCLAIMER} Covers 500 sample addresses in California, New Jersey and Massachusetts.</p>
    </div>
  );
}
