import { assertDb } from "./db-result";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

async function rolesOf(ctx: Ctx): Promise<string[]> {
  const result = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  assertDb(result); const data=result.data;
  return (data ?? []).map((r: { role: string }) => r.role);
}

function tally(rows: { [k: string]: unknown }[] | null, key: string) {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) { const k = String(r[key] ?? "unknown"); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** Staff monitoring snapshot: job health, review queue, recent activity. */
export const getMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await rolesOf(ctx);
    if (!roles.includes("admin") && !roles.includes("reviewer")) throw new Error("Staff permission required");
    const s = ctx.supabase;
    const [runs, recentRuns, geo, rules, audit, datasets] = await Promise.all([
      s.from("extraction_runs").select("status,source_documents!inner(dataset_versions!inner(status))").eq("source_documents.dataset_versions.status","active").limit(5000),
      s.from("extraction_runs").select("id,status,chunk_index,chunk_count,valid,invalid,error,created_at,model,source_documents!inner(doc_id,dataset_versions!inner(status))").eq("source_documents.dataset_versions.status","active").order("created_at", { ascending: false }).limit(25),
      s.from("jurisdiction_resolutions").select("status,properties!inner(dataset_versions!inner(status))").eq("properties.dataset_versions.status","active").eq("is_current", true).limit(5000),
      s.from("rule_versions").select("review_state,source_documents!inner(dataset_versions!inner(status))").eq("source_documents.dataset_versions.status","active").eq("is_current", true).limit(10000),
      s.from("audit_log").select("id,actor,action,entity,entity_id,created_at").order("created_at", { ascending: false }).limit(50),
      s.from("dataset_versions").select("id,status,package_name,created_at,upload_sha256").order("created_at", { ascending: false }).limit(10),
    ]);
    for (const result of [runs,recentRuns,geo,rules,audit,datasets]) assertDb(result);
    const errors = (recentRuns.data ?? []).filter((r: { status: string }) => r.status === "error").length;
    return {
      extraction: tally(runs.data, "status"),
      geocoding: tally(geo.data, "status"),
      review: tally(rules.data, "review_state"),
      recentRuns: recentRuns.data ?? [],
      recentErrors: errors,
      audit: audit.data ?? [],
      datasets: datasets.data ?? [],
    };
  });

/** Admin-only: list accounts with roles. */
export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    if (!(await rolesOf(ctx)).includes("admin")) throw new Error("Admin permission required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
    if (error) throw new Error(error.message);
    const roleResult = await supabaseAdmin.from("user_roles").select("user_id,role");
    assertDb(roleResult); const roleRows=roleResult.data;
    const byUser = new Map<string, string[]>();
    for (const r of roleRows ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
    return data.users.map((u) => ({
      id: u.id, email: u.email ?? "", created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: !!u.email_confirmed_at, roles: byUser.get(u.id) ?? [], isSelf: u.id === ctx.userId,
    }));
  });

/** Admin-only: grant or revoke a role. Admins cannot remove their own admin role. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: z.enum(["admin", "reviewer", "user"]), grant: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    if (!(await rolesOf(ctx)).includes("admin")) throw new Error("Admin permission required");
    if (!data.grant && data.role === "admin" && data.userId === ctx.userId) throw new Error("You cannot remove your own admin role");
    const q = data.grant
      ? ctx.supabase.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" })
      : ctx.supabase.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    const { error } = await q;
    if (error) throw new Error(error.message);
    assertDb(await ctx.supabase.from("audit_log").insert({ actor: ctx.userId, action: data.grant ? "role.grant" : "role.revoke", entity: "user_roles", entity_id: data.userId, detail: { role: data.role } }));
    return { ok: true };
  });
