"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Database,
  LayoutDashboard,
  Moon,
  Sun,
  Terminal,
  Sparkles,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";

const NAV_ITEMS = [
  { href: "/", label: "Dashboards", icon: LayoutDashboard },
  { href: "/explore", label: "Chart Studio", icon: BarChart3 },
  { href: "/sources", label: "Data Sources", icon: Database },
  { href: "/sql", label: "SQL Lab", icon: Terminal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 h-14 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
        <div className="h-full max-w-[1600px] mx-auto px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm text-white font-bold text-sm">
                Q
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-bold tracking-tight text-slate-900 dark:text-white text-[15px]">
                  QuackBoard
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  Open-Source BI
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/dashboards")
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60"
              title="In-browser analytical SQL powered by DuckDB-Wasm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>DuckDB-Wasm Ready</span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
