import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

  return {
    session, ready, roles,
    isAdmin: roles.includes("admin"),
    isStaff: roles.includes("admin") || roles.includes("reviewer"),
  };
}
