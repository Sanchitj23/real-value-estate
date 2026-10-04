import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/ui";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff sign in — Housing Law Navigator" },
      { name: "description", content: "Sign in to import data, run extraction and review rules." },
      { property: "og:title", content: "Staff sign in — Housing Law Navigator" },
      { property: "og:description", content: "Reviewer and admin access." },
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message); else nav({ to: "/admin" });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/admin" } });
      if (error) toast.error(error.message);
      else if (!data.session) toast.success("Check your email to confirm the account.");
      else nav({ to: "/admin" });
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Staff access" title={mode === "in" ? "Sign in" : "Create account"}>
        Public sample results are readable without an account. The first account created becomes the admin; admins can grant reviewer access.
      </PageHeader>
      <form onSubmit={submit} className="paper space-y-3 rounded-sm p-6">
        <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" required minLength={8} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={busy} className="w-full">{mode === "in" ? "Sign in" : "Create account"}</Button>
        <button type="button" className="w-full text-center text-xs underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Need an account? Create one" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
