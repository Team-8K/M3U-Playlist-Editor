import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ListMusic, LogOut, Menu, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

interface Props {
  session: Session;
  children: React.ReactNode;
}

export const AppShell = ({ session, children }: Props) => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/editor",    label: "Editor",    icon: ListMusic },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Fixed Header ─────────────────────────────────────────────────
          isolation: isolate creates its own stacking context so nothing
          rendered inside <main> (SidebarProvider, Sheet overlays, etc.)
          can ever paint on top of the header.
      ──────────────────────────────────────────────────────────────────── */}
      <header
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          zIndex: 1000,
          isolation: "isolate",          // own stacking context
          background: "hsl(0 0% 5% / 0.97)",
          borderBottom: "1px solid hsl(45 20% 15%)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Logo */}
        <Link
          to="/dashboard"
          style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0, textDecoration: "none" }}
        >
          <img
            src="https://dedicated-team8k.store/logo.png"
            alt="Team 8K"
            style={{ height: "32px", width: "32px", borderRadius: "8px", objectFit: "cover", display: "block", flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: "15px",
              letterSpacing: "0.2em",
              background: "linear-gradient(135deg, #c9a227, #f5d76e)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              whiteSpace: "nowrap",
            }}
          >
            TEAM 8K
          </span>
        </Link>

        {/* Desktop nav */}
        <nav style={{ display: "flex", alignItems: "center", gap: "4px" }} className="hidden md:flex">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to || (to === "/dashboard" && location.pathname === "/");
            return (
              <Link
                key={to}
                to={to}
                style={{ textDecoration: "none" }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold tracking-widest uppercase transition-all duration-200 ${
                  active
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right side: email + logout */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="hidden md:block text-xs text-muted-foreground truncate max-w-[180px]">
            {session.user.email}
          </span>

          {/* Sign out — plain HTML button, no z-index games needed because
              the header has isolation:isolate and is already above everything */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide border transition-all duration-200 hover:text-primary hover:border-primary/40"
            style={{
              color: "hsl(45 8% 60%)",
              borderColor: "hsl(45 20% 15%)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:block">Sign out</span>
          </button>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 text-muted-foreground hover:text-foreground"
            style={{ cursor: "pointer" }}
            onClick={() => setMobileOpen(v => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {mobileOpen && (
        <div
          className="fixed top-14 left-0 right-0 border-b border-border/50 p-3 flex flex-col gap-1"
          style={{ zIndex: 999, background: "hsl(0 0% 5% / 0.98)" }}
        >
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                style={{ textDecoration: "none" }}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold tracking-widest uppercase ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
          <div className="pt-2 mt-1 border-t border-border/40 px-4 pb-1">
            <span className="text-xs text-muted-foreground">{session.user.email}</span>
          </div>
        </div>
      )}

      {/* ── Page content — padded for fixed header ───────────────────── */}
      <main className="flex-1 pt-14">
        {children}
      </main>
    </div>
  );
};
