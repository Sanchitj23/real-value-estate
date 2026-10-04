import { requireStaffPage } from "@/lib/staff-guard";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMonitoring, listUsers, setUserRole } from "@/lib/console.functions";
import { PageHeader, Stat } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/console")({
  beforeLoad: () => requireStaffPage(false),
  head: () => ({
    meta: [
      { title: "Admin console — monitoring & users — Housing Law Navigator" },
      { name: "description", content: "Monitor extraction, geocoding and review activity, and manage staff accounts and roles." },
      { property: "og:title", content: "Admin console — Housing Law Navigator" },
      { property: "og:description", content: "Job health, review queue, activity log and user roles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Console,
});

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
const Tally = ({ t }: { t: Record<string, number> }) => (
  <div className="flex flex-wrap gap-2 text-xs">
    {Object.keys(t).length === 0 ? <span className="text-muted-foreground">No data yet</span> :
      Object.entries(t).map(([k, v]) => <span key={k} className="rounded-sm border border-border px-2 py-0.5 font-mono">{k}: {v}</span>)}
  </div>
);

function Console() {
  const { session, isAdmin, isStaff, ready } = useAuth();
  if (!ready) return <p>Loading…</p>;
  if (!session || !isStaff) return <div className="paper rounded-sm p-6"><p>The admin console is for staff accounts.</p><Link to="/auth" className="underline">Sign in</Link></div>;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin console" title="Monitor & manage">
        Live health of extraction and address jobs, the review queue, the activity log, and who has access.
      </PageHeader>
      <Tabs defaultValue="monitor">
        <TabsList>
          <TabsTrigger value="monitor">Monitoring</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          {isAdmin && <TabsTrigger value="users">Users & roles</TabsTrigger>}
        </TabsList>
        <Monitoring />
        {isAdmin && <TabsContent value="users"><Users /></TabsContent>}
      </Tabs>
    </div>
  );
}

function Monitoring() {
  const fMon = useServerFn(getMonitoring);
  const q = useQuery({ queryKey: ["monitoring"], queryFn: () => fMon(), refetchInterval: 15000 });
  const m = q.data as any;
  return (
    <>
      <TabsContent value="monitor" className="space-y-4">
        {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        {m && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Extraction steps" value={Object.values(m.extraction as Record<string, number>).reduce((a, b) => a + b, 0)} hint={`${m.extraction.error ?? 0} failed`} />
            <Stat label="Recent failures" value={m.recentErrors} hint="last 25 steps" />
            <Stat label="Addresses resolved" value={m.geocoding.resolved ?? 0} hint={`${(m.geocoding.no_match ?? 0) + (m.geocoding.ambiguous ?? 0)} unresolved`} />
            <Stat label="Rules needing review" value={m.review.validated_auto ?? 0} hint={`${m.review.invalid ?? 0} invalid`} />
          </div>
          <section className="paper space-y-2 rounded-sm p-5">
            <h2 className="text-xl">Status breakdown</h2>
            <div className="eyebrow">Extraction</div><Tally t={m.extraction} />
            <div className="eyebrow">Address resolution</div><Tally t={m.geocoding} />
            <div className="eyebrow">Rule review</div><Tally t={m.review} />
          </section>
          <section className="paper rounded-sm p-5">
            <h2 className="mb-2 text-xl">Recent extraction steps</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground"><tr><th>When</th><th>Source</th><th>Part</th><th>Status</th><th>Valid / invalid</th><th>Error</th></tr></thead>
              <tbody>{m.recentRuns.map((r: any) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{fmt(r.created_at)}</td><td className="font-mono">{r.source_documents?.doc_id}</td>
                  <td>{r.chunk_index + 1}/{r.chunk_count}</td>
                  <td className={r.status === "error" ? "text-destructive" : ""}>{r.status}</td>
                  <td>{r.valid} / {r.invalid}</td><td className="max-w-xs truncate text-xs">{r.error ?? ""}</td>
                </tr>))}
              </tbody>
            </table>
          </section>
          <section className="paper rounded-sm p-5">
            <h2 className="mb-2 text-xl">Dataset versions</h2>
            {m.datasets.map((d: any) => (
              <div key={d.id} className="flex gap-4 border-t border-border py-1 text-sm">
                <span className="font-mono">{d.upload_sha256.slice(0, 12)}…</span><span>{d.package_name ?? "—"}</span><span>{d.status}</span><span className="ml-auto text-muted-foreground">{fmt(d.created_at)}</span>
              </div>))}
          </section>
        </>}
      </TabsContent>
      <TabsContent value="activity">
        <section className="paper rounded-sm p-5">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th>When</th><th>Action</th><th>Item</th><th>By</th></tr></thead>
            <tbody>{(m?.audit ?? []).map((a: any) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-1">{fmt(a.created_at)}</td><td className="font-mono">{a.action}</td>
                <td className="font-mono text-xs">{a.entity} {a.entity_id?.slice(0, 12)}</td><td className="font-mono text-xs">{a.actor?.slice(0, 8)}</td>
              </tr>))}
            </tbody>
          </table>
          {m && m.audit.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
        </section>
      </TabsContent>
    </>
  );
}

function Users() {
  const qc = useQueryClient();
  const fList = useServerFn(listUsers), fSet = useServerFn(setUserRole);
  const q = useQuery({ queryKey: ["users"], queryFn: () => fList() });
  async function toggle(userId: string, role: "admin" | "reviewer", grant: boolean) {
    try { await fSet({ data: { userId, role, grant } }); toast.success(`${grant ? "Granted" : "Removed"} ${role}`); qc.invalidateQueries({ queryKey: ["users"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <section className="paper rounded-sm p-5">
      <p className="mb-3 text-sm text-muted-foreground">Reviewers can edit rules, mappings and scenarios. Admins can also import data, run jobs and manage users. New sign-ups start as regular users.</p>
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr><th>Email</th><th>Roles</th><th>Joined</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>{(q.data ?? []).map((u) => {
          const isRev = u.roles.includes("reviewer"), isAdm = u.roles.includes("admin");
          return (
            <tr key={u.id} className="border-t border-border">
              <td className="py-2">{u.email}{u.isSelf && " (you)"}{!u.confirmed && <span className="ml-1 text-xs text-st-unknown">unconfirmed</span>}</td>
              <td className="font-mono text-xs">{u.roles.join(", ") || "user"}</td>
              <td className="text-xs">{fmt(u.created_at)}</td><td className="text-xs">{fmt(u.last_sign_in_at)}</td>
              <td className="space-x-2 text-right">
                <Button size="sm" variant="outline" onClick={() => toggle(u.id, "reviewer", !isRev)}>{isRev ? "Remove reviewer" : "Make reviewer"}</Button>
                <Button size="sm" variant="outline" disabled={u.isSelf && isAdm} onClick={() => toggle(u.id, "admin", !isAdm)}>{isAdm ? "Remove admin" : "Make admin"}</Button>
              </td>
            </tr>);
        })}</tbody>
      </table>
    </section>
  );
}
