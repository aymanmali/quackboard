"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Database,
  Download,
  LayoutDashboard,
  Plus,
  Trash2,
  Upload,
  ArrowRight,
  FileSpreadsheet,
  Sparkles,
} from "lucide-react";
import { Dashboard, Dataset, SavedChart } from "@/lib/query/types";
import {
  deleteDashboard,
  exportDashboardBundle,
  importDashboardBundle,
  listCharts,
  listDashboards,
  listDatasets,
  saveDashboard,
} from "@/lib/storage/indexeddb-store";

export default function HomePage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newDashName, setNewDashName] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [dList, cList, dsList] = await Promise.all([
        listDashboards(),
        listCharts(),
        listDatasets(),
      ]);
      setDashboards(dList);
      setCharts(cList);
      setDatasets(dsList);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDashName.trim() || "Untitled Dashboard";
    const now = new Date().toISOString();
    const dash: Dashboard = {
      id: `dash-${crypto.randomUUID().slice(0, 8)}`,
      name,
      description: "Custom interactive BI dashboard",
      tiles: [],
      globalFilters: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveDashboard(dash);
    setNewDashName("");
    setCreating(false);
    router.push(`/dashboards/${dash.id}`);
  };

  const handleExport = async (id: string, name: string) => {
    const bundle = await exportDashboardBundle(id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.quackboard.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = await importDashboardBundle(parsed);
      setStatusMsg(`Imported "${imported.name}" successfully.`);
      await loadAll();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Failed to import dashboard file.");
    } finally {
      e.target.value = "";
    }
  };

  const handleDeleteDashboard = async (id: string) => {
    await deleteDashboard(id);
    await loadAll();
  };

  return (
    <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Hero Banner */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Zero-Friction Open-Source BI</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Build interactive dashboards at DuckDB speed.
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
              Drop CSV, Parquet, or Excel files right in your browser—or connect live PostgreSQL &
              MySQL databases—then build cross-filtered dashboards with Tableau-style shelves.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              Open Chart Studio
            </Link>
            <Link
              href="/sources"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload / Connect Data
            </Link>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Dashboard
            </button>
          </div>
        </div>

        {creating && (
          <form
            onSubmit={handleCreateDashboard}
            className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3"
          >
            <input
              type="text"
              value={newDashName}
              onChange={(e) => setNewDashName(e.target.value)}
              placeholder="e.g., Q4 Marketing Funnel, Product KPIs..."
              autoFocus
              className="flex-1 min-w-[240px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
            >
              Create & Open
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {statusMsg && (
          <div className="mt-4 px-3.5 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            {statusMsg}
          </div>
        )}
      </section>

      {/* Dashboards Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dashboards</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
              {dashboards.length}
            </span>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import .quackboard.json
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-44 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dashboards.map((dash) => (
              <div
                key={dash.id}
                className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-blue-400 dark:hover:border-blue-600 transition-all flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/dashboards/${dash.id}`}
                      className="font-bold text-base text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                    >
                      {dash.name}
                    </Link>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                      {dash.tiles.length} tiles
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {dash.description || "Interactive dashboard"}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <Link
                    href={`/dashboards/${dash.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open Dashboard
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleExport(dash.id, dash.name)}
                      title="Export .quackboard.json"
                      className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {dashboards.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDashboard(dash.id)}
                        title="Delete dashboard"
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bottom Split: Datasets & Saved Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Datasets ({datasets.length})
              </h3>
            </div>
            <Link
              href="/sources"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              Manage Sources →
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {datasets.map((ds) => (
              <div key={ds.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {ds.name}
                    </span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                      {ds.dialect}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {ds.rowCount.toLocaleString()} rows • {ds.columns.length} columns
                  </p>
                </div>
                <Link
                  href={`/explore?datasetId=${ds.id}`}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  Explore
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Saved Charts ({charts.length})
              </h3>
            </div>
            <Link
              href="/explore"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              + New Chart
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-auto">
            {charts.map((ch) => (
              <div key={ch.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {ch.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                    {ch.chartType.replace("_", " ")} chart
                  </div>
                </div>
                <Link
                  href={`/explore?chartId=${ch.id}`}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  Edit
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
