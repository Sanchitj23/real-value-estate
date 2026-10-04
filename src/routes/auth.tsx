import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
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

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) nav({ to: "/dashboard", replace: true }); });
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <Link to="/" className="mb-8 font-serif text-2xl text-ink">Housing Law <em>Navigator</em></Link>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-md border border-border bg-card p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-medium text-foreground">{mode === "in" ? "Sign in" : "Create your account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "in" ? "Welcome back." : "It takes less than a minute."}</p>
        </div>
        <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" required minLength={8} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={busy} className="w-full">{mode === "in" ? "Sign in" : "Create account"}</Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <Button type="button" variant="outline" disabled={busy} className="w-full" onClick={async () => {
          const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
          if (result.error) { toast.error(result.error.message ?? "Google sign-in failed"); return; }
          if (result.redirected) return;
          nav({ to: "/dashboard" });
        }}>Continue with Google</Button>
        <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
