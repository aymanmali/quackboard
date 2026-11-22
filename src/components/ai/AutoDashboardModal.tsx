"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { callAutoDashboard } from "@/lib/ai/ai-client";
import {
  Dashboard,
  DashboardGlobalFilter,
  DashboardTile,
  Dataset,
  DEFAULT_CHART_FORMATTING,
  SavedChart,
} from "@/lib/query/types";
import { saveChart, saveDashboard } from "@/lib/storage/indexeddb-store";

interface AutoDashboardModalProps {
  open: boolean;
  onClose: () => void;
  datasets: Dataset[];
  initialDatasetId?: string;
}

export function AutoDashboardModal({
  open,
  onClose,
  datasets,
  initialDatasetId,
}: AutoDashboardModalProps) {
  const router = useRouter();
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [goal, setGoal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedDatasetId(initialDatasetId || datasets[0]?.id || "");
  }, [open, initialDatasetId, datasets]);

  if (!open) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataset = datasets.find((d) => d.id === selectedDatasetId);
    if (!dataset) return;

    setGenerating(true);
    setError(null);
    try {
      const plan = await callAutoDashboard(dataset, goal.trim() || undefined);
      const now = new Date().toISOString();

      const kpiSpecs = plan.charts.filter((c) => c.chartType === "kpi");
      const visualSpecs = plan.charts.filter((c) => c.chartType !== "kpi");
      const tiles: DashboardTile[] = [];

      // Top row: KPI tiles (4 cols each across 12-col grid)
      let currentY = 0;
      const kpiWidth = kpiSpecs.length > 0 ? Math.max(3, Math.floor(12 / Math.min(3, kpiSpecs.length))) : 4;
      for (let i = 0; i < kpiSpecs.length; i++) {
        const spec = kpiSpecs[i];
        const chartId = `chart-${crypto.randomUUID().slice(0, 8)}`;
        const chart: SavedChart = {
          id: chartId,
          name: spec.title,
          description: spec.description,
          datasetId: dataset.id,
          chartType: spec.chartType,
          query: spec.query,
          formatting: { ...DEFAULT_CHART_FORMATTING, ...spec.formatting },
          createdAt: now,
          updatedAt: now,
        };
        await saveChart(chart);

        const colIdx = i % 3;
        const rowOffset = Math.floor(i / 3) * 3;
        const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
        tiles.push({
          id: tileId,
          kind: "chart",
          chartId,
          layout: {
            i: tileId,
            x: colIdx * kpiWidth,
            y: rowOffset,
            w: kpiWidth,
            h: 3,
            minW: 3,
            minH: 2,
          },
        });
        currentY = Math.max(currentY, rowOffset + 3);
      }

      // Main visual charts in 2-column grid
      for (let i = 0; i < visualSpecs.length; i++) {
        const spec = visualSpecs[i];
        const chartId = `chart-${crypto.randomUUID().slice(0, 8)}`;
        const chart: SavedChart = {
          id: chartId,
          name: spec.title,
          description: spec.description,
          datasetId: dataset.id,
          chartType: spec.chartType,
          query: spec.query,
          formatting: { ...DEFAULT_CHART_FORMATTING, ...spec.formatting },
          createdAt: now,
          updatedAt: now,
        };
        await saveChart(chart);

        const isLastOdd = i === visualSpecs.length - 1 && visualSpecs.length % 2 === 1;
        const rowOffset = currentY + Math.floor(i / 2) * 7;
        const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
        tiles.push({
          id: tileId,
          kind: "chart",
          chartId,
          layout: {
            i: tileId,
            x: isLastOdd ? 0 : (i % 2) * 6,
            y: rowOffset,
            w: isLastOdd ? 12 : 6,
            h: 7,
            minW: 4,
            minH: 5,
          },
        });
      }

      const globalFilters: DashboardGlobalFilter[] = plan.globalFilterColumns.map((col, idx) => ({
        id: `gf-ai-${idx}-${crypto.randomUUID().slice(0, 4)}`,
        label: col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        datasetId: dataset.id,
        column: col,
        type: "select",
      }));

      const dashId = `dash-${crypto.randomUUID().slice(0, 8)}`;
      const dashboard: Dashboard = {
        id: dashId,
        name: plan.name,
        description: `${plan.description} (${plan.engine})`,
        tiles,
        globalFilters,
        createdAt: now,
        updatedAt: now,
      };

      await saveDashboard(dashboard);
      onClose();
      router.push(`/dashboards/${dashId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate dashboard");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleGenerate}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 text-white flex items-center justify-center shadow-sm">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                1-Click AI Auto-Dashboard
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Synthesize KPIs, interactive charts & filters automatically
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Dataset
            </label>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.rowCount.toLocaleString()} rows • {ds.columns.length} cols)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Analytical Focus Goal (Optional)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g., Executive revenue, regional profitability, & product leaders..."
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generating || !selectedDatasetId}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Building Dashboard...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generate Dashboard
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
