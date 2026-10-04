/**
 * Assistant-question credits, kept as an append-only ledger in audit_log (no extra table or migration):
 *   assistant.query   actor = user, one row per answered question
 *   credits.grant     entity_id = user, detail.amount, written by an admin
 *   credits.request   entity_id = user, a user asking for more
 * Balance = FREE_CREDITS + granted - used. Reviewers and admins are not metered.
 */
import { FREE_CREDITS } from "./credits";
export const LEDGER_ENTITY = "user_credits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type CreditBalance = {
  unlimited: boolean; free: number; granted: number; used: number;
  /** null when unlimited. */ remaining: number | null;
  requested: boolean;
};

export function balanceFrom(rows: Array<{ action: string; detail: unknown }>, unlimited: boolean): CreditBalance {
  let used = 0, granted = 0, lastRequest = -1, lastGrant = -1;
  rows.forEach((r, i) => {
    if (r.action === "assistant.query") used++;
    else if (r.action === "credits.grant") { granted += Math.max(0, Math.floor(Number((r.detail as { amount?: unknown } | null)?.amount) || 0)); lastGrant = i; }
    else if (r.action === "credits.request") lastRequest = i;
  });
  return { unlimited, free: FREE_CREDITS, granted, used, remaining: unlimited ? null : Math.max(0, FREE_CREDITS + granted - used), requested: lastRequest > lastGrant };
}

/** Ledger rows for one user, oldest first. `admin` must be the service-role client: ordinary users cannot read audit_log. */
export async function ledgerFor(admin: Db, userId: string) {
  const [mine, about] = await Promise.all([
    admin.from("audit_log").select("action,detail,created_at").eq("action", "assistant.query").eq("actor", userId).order("created_at", { ascending: true }).limit(5000),
    admin.from("audit_log").select("action,detail,created_at").in("action", ["credits.grant", "credits.request"]).eq("entity", LEDGER_ENTITY).eq("entity_id", userId).order("created_at", { ascending: true }).limit(1000),
  ]);
  if (mine.error) throw new Error(`Usage ledger unavailable: ${mine.error.message}`);
  if (about.error) throw new Error(`Usage ledger unavailable: ${about.error.message}`);
  return [...(mine.data ?? []), ...(about.data ?? [])].sort((a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at)) as Array<{ action: string; detail: unknown; created_at: string }>;
}
