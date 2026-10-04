import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Client-side page gate for staff areas. Server functions and RLS still enforce access. */
export async function requireStaffPage(adminOnly = false) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw redirect({ to: "/auth" });
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
  const roles = (data ?? []).map((r) => r.role as string);
  const ok = adminOnly ? roles.includes("admin") : roles.includes("admin") || roles.includes("reviewer");
  if (!ok) throw redirect({ to: "/dashboard" });
}
