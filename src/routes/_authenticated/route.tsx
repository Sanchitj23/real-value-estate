import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Search, Building2, Scale, GitCompare, Map, Upload, Activity, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DISCLAIMER } from "@/lib/engine/applicability";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: DashboardLayout,
});

const MAIN = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/renter", label: "Address lookup", icon: Search },
  { to: "/manager", label: "Portfolio", icon: Building2 },
  { to: "/changes", label: "Law changes", icon: GitCompare },
  { to: "/map", label: "Map", icon: Map },
] as const;
const STAFF = [
  { to: "/reviewer", label: "Rule review", icon: Scale },
  { to: "/admin", label: "Data & jobs", icon: Upload },
  { to: "/console", label: "Console & users", icon: Activity },
] as const;

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Search }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground font-medium" }}>
      <Icon className="h-4 w-4" />{label}
    </Link>
  );
}

function DashboardLayout() {
  const { session, roles, isStaff } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/dashboard" className="mb-6 px-3 font-serif text-lg text-sidebar-foreground">Housing Law <em>Navigator</em></Link>
        <nav className="space-y-1">{MAIN.map((n) => <NavItem key={n.to} {...n} />)}</nav>
        {isStaff && <>
          <div className="mb-2 mt-6 px-3 text-[0.65rem] uppercase tracking-widest text-sidebar-foreground/50">Staff</div>
          <nav className="space-y-1">{STAFF.map((n) => <NavItem key={n.to} {...n} />)}</nav>
        </>}
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <div className="truncate px-3 text-xs text-sidebar-foreground">{session?.user.email}</div>
          <div className="px-3 font-mono text-[0.65rem] text-sidebar-foreground/60">{roles.join(", ") || "user"}</div>
          <button onClick={signOut} className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 overflow-x-auto border-b border-border bg-card px-4 py-2 md:hidden">
          {[...MAIN, ...(isStaff ? STAFF : [])].map((n) => <Link key={n.to} to={n.to} className="whitespace-nowrap text-xs text-muted-foreground" activeProps={{ className: "text-foreground font-medium" }}>{n.label}</Link>)}
          <button onClick={signOut} className="ml-auto text-xs underline">Sign out</button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8"><Outlet /></main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">{DISCLAIMER}</footer>
      </div>
    </div>
  );
}
