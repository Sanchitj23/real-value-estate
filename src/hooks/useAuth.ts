import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { DEMO, DEMO_USER } from "@/lib/demo";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRoles([]); return; }
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).then(({ data }) => setRoles((data ?? []).map((r) => r.role)));
  }, [session]);

  // Local demo mode shows the ordinary (non-staff) experience without an account.
  if (DEMO && !session) return { session: { user: DEMO_USER } as unknown as Session, ready: true, roles: [] as string[], isAdmin: false, isStaff: false };
  return {
    session, ready, roles,
    isAdmin: roles.includes("admin"),
    isStaff: roles.includes("admin") || roles.includes("reviewer"),
  };
}
