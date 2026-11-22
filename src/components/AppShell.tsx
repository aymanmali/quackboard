"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  Database,
  LayoutDashboard,
  Moon,
  Sun,
  Terminal,
  Sparkles,
} from "lucide-react";
import { loadAiConfig } from "@/lib/ai/ai-client";
import { AiProviderId } from "@/lib/ai/types";
import { AiSettingsModal } from "./ai/AiSettingsModal";
import { useTheme } from "./ThemeProvider";

const NAV_ITEMS = [
  { href: "/", label: "Dashboards", icon: LayoutDashboard },
  { href: "/explore", label: "Chart Studio", icon: BarChart3 },
  { href: "/agent", label: "AI Analyst", icon: Bot },
  { href: "/sources", label: "Data Sources", icon: Database },
  { href: "/sql", label: "SQL Lab", icon: Terminal },
];

function formatAiBadgeLabel(provider: AiProviderId, hasKey: boolean): string {
  switch (provider) {
    case "google":
      return hasKey ? "AI: Gemini BYOK" : "AI: Gemini";
    case "openai":
      return hasKey ? "AI: OpenAI BYOK" : "AI: OpenAI";
    case "anthropic":
      return hasKey ? "AI: Claude BYOK" : "AI: Claude";
    case "local":
      return "AI: Local Engine";
    case "auto":
    default:
      return hasKey ? "AI: Auto (BYOK)" : "AI: Auto / Local";
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLabel, setAiLabel] = useState("AI: Auto / Local");

  useEffect(() => {
    const refreshLabel = () => {
      const cfg = loadAiConfig();
      setAiLabel(formatAiBadgeLabel(cfg.provider, Boolean(cfg.apiKey?.trim())));
    };
    refreshLabel();
    window.addEventListener("quackboard-ai-config-changed", refreshLabel);
    return () => window.removeEventListener("quackboard-ai-config-changed", refreshLabel);
  }, []);

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
                  AI Visual BI
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
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              title="Configure AI provider or Bring Your Own Key (BYOK)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 dark:bg-violet-950/50 dark:hover:bg-violet-900/60 dark:text-violet-300 dark:border-violet-800/70 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{aiLabel}</span>
            </button>

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

      <AiSettingsModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
    </div>
  );
}
