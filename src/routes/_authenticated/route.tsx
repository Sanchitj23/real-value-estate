import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Activity, Building2, CalendarClock, LogOut, Map, Menu, MessageSquareText, Scale, Search, Upload, UserRound, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DISCLAIMER } from "@/lib/engine/applicability";
import { creditLine, resetAssistant, useCredits } from "@/components/app/Assistant";

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
  { to: "/dashboard", label: "Ask", icon: MessageSquareText },
  { to: "/renter", label: "Find a property", icon: Search },
  { to: "/changes", label: "Law changes", icon: CalendarClock },
  { to: "/map", label: "Map", icon: Map },
  { to: "/manager", label: "All sample properties", icon: Building2 },
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
  const { session, isStaff } = useAuth();
  const credits = useCredits();
  const qc = useQueryClient();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);

  async function signOut() {
    await qc.cancelQueries(); qc.clear(); resetAssistant();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  }

  const links = (
    <>
      <nav className="space-y-1">{MAIN.map((n) => <NavItem key={n.to} {...n} />)}</nav>
      {isStaff && <>
        <div className="mb-2 mt-6 px-3 text-xs font-medium text-sidebar-foreground/50">Staff</div>
        <nav className="space-y-1">{STAFF.map((n) => <NavItem key={n.to} {...n} />)}</nav>
      </>}
    </>
  );
  const account = (
    <div className="border-t border-sidebar-border pt-3">
      <Link to="/account" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground font-medium" }}>
        <UserRound className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <span className="block">Account</span>
          <span className="block truncate text-xs text-sidebar-foreground/60">{session?.user.email}</span>
        </span>
      </Link>
      {credits.data && <div className="px-3 pb-1 pt-1 text-xs text-sidebar-foreground/60">{creditLine(credits.data.balance)}</div>}
      <button onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent"><LogOut className="h-4 w-4" />Sign out</button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex print:hidden">
        <Link to="/dashboard" className="mb-6 px-3 font-serif text-lg text-sidebar-foreground">Housing Law <em>Navigator</em></Link>
        {links}
        <div className="mt-auto">{account}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card px-4 py-2.5 md:hidden print:hidden">
          <Link to="/dashboard" className="font-serif text-lg text-ink">Housing Law <em>Navigator</em></Link>
          <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md p-2 hover:bg-muted">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </header>
        {open && <div className="fixed inset-x-0 top-[3.1rem] z-20 max-h-[calc(100vh-3.1rem)] overflow-auto border-b border-border bg-sidebar p-4 shadow-lg md:hidden print:hidden">{links}<div className="mt-4">{account}</div></div>}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
          <Outlet />
        </main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">{DISCLAIMER} Covers 500 sample addresses in CA, NJ and MA.</footer>
      </div>
    </div>
  );
}
