import { Compass, FolderKanban, LayoutDashboard, LogOut, MessageSquare, Moon, PlayCircle, Shield, Sun, UserCircle, Users2, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Avatar, Button } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { cn } from "@/utils/cn";
import { NotificationBell } from "./NotificationBell";
import { startTour, tourSeen } from "./Tour";

export function Brand({ to = "/" }: { to?: string }) {
  return <Link to={to} className="flex items-center gap-2 font-semibold tracking-tight"><span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground text-xs">✓</span>CPMS</Link>;
}

export function useTheme() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const toggle = () => { const n = !dark; setDark(n); document.documentElement.classList.toggle("dark", n); localStorage.setItem("cpms_theme", n ? "dark" : "light"); };
  return { dark, toggle };
}

/** App shell: sidebar + top bar. Also starts the realtime socket and the first-time tour. */
export function Layout() {
  const { profile, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  useRealtime(!!profile);
  useEffect(() => { if (profile && !tourSeen()) setTimeout(startTour, 600); }, [profile?.id]);

  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "nav-dashboard" },
    { to: "/projects", label: "Projects", icon: FolderKanban, tour: "nav-projects" },
    { to: "/discover", label: "Find projects", icon: Compass, tour: "nav-discover" },
    { to: "/messages", label: "Messages", icon: MessageSquare, tour: "nav-messages" },
    { to: "/forum", label: "Community", icon: Users2 },
    ...(profile?.role === "admin" ? [{ to: "/admin", label: "Administration", icon: Shield }] : []),
  ] as { to: string; label: string; icon: typeof Shield; tour?: string }[];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-[232px] border-r bg-background p-3 transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="px-2 py-2"><Brand to="/dashboard" /></div>
        <nav className="mt-4 space-y-0.5" onClick={() => setOpen(false)}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} data-tour={i.tour} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", isActive && "bg-accent font-medium text-foreground")}>
              <i.icon className="h-4 w-4" />{i.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-4 w-4" /></Button>
          <div className="hidden lg:block" />
          <div className="relative flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
            <NotificationBell />
            <button data-tour="user-menu" onClick={() => setMenu((m) => !m)} className="ml-1 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
              <Avatar name={profile?.full_name} src={profile?.avatar_url} /><span className="hidden text-xs font-medium sm:block">{profile?.full_name}</span>
            </button>
            {menu && (
              <div className="absolute right-0 top-10 z-30 w-52 animate-fade-in rounded-lg border bg-card p-1 shadow-lg" onClick={() => setMenu(false)}>
                <div className="px-2.5 py-2 text-xs text-muted-foreground"><p className="truncate font-medium text-foreground">{profile?.email}</p><p className="capitalize">{profile?.role}</p></div>
                <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent" onClick={() => nav("/profile")}><UserCircle className="h-4 w-4" />Profile</button>
                <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent" onClick={startTour}><PlayCircle className="h-4 w-4" />Replay tour</button>
                <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-danger hover:bg-accent" onClick={() => signOut().then(() => nav("/"))}><LogOut className="h-4 w-4" />Sign out</button>
              </div>
            )}
          </div>
        </header>
        {profile && !profile.profile_complete && (
          <div className="border-b bg-warning/10 px-4 py-2 text-xs">Complete your profile (university, course, skills, GitHub username) so teammates and reviewers can find you. <Link to="/profile" className="font-medium underline">Open profile</Link></div>
        )}
        <main className="mx-auto max-w-6xl animate-fade-in px-4 py-6"><Outlet /></main>
      </div>
    </div>
  );
}
