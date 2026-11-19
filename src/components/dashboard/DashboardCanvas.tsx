"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Responsive, WidthProvider, Layout } from "react-grid-layout";
import {
  ArrowLeft,
  Download,
  Edit3,
  ExternalLink,
  Filter,
  GripHorizontal,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
  FileText,
  BarChart3,
} from "lucide-react";
import {
  Dashboard,
  DashboardTile,
  Dataset,
  QueryFilter,
  QueryResult,
  SavedChart,
} from "@/lib/query/types";
import { executeVisualQuery, fetchDistinctColumnValues } from "@/lib/engines/query-runner";
import {
  exportDashboardBundle,
  getDashboard,
  listCharts,
  listDatasets,
  saveDashboard,
} from "@/lib/storage/indexeddb-store";
import { ChartView } from "../charts/ChartView";
import { EChartsHandle } from "../charts/EChartsRenderer";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface CrossFilterState {
  sourceChartId: string;
  datasetId: string;
  column: string;
  value: string;
}

function DashboardChartTile({
  tile,
  chart,
  dataset,
  activeFilters,
  editMode,
  onCrossFilter,
  onRemove,
}: {
  tile: DashboardTile;
  chart: SavedChart;
  dataset: Dataset | undefined;
  activeFilters: QueryFilter[];
  editMode: boolean;
  onCrossFilter: (column: string, value: string) => void;
  onRemove: () => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const echartsRef = useRef<EChartsHandle | null>(null);

  const mergedQuery = useMemo(() => {
    const mergedFilters = [...(chart.query.filters ?? []), ...activeFilters];
    return {
      ...chart.query,
      filters: mergedFilters,
    };
  }, [chart.query, activeFilters]);

  useEffect(() => {
    if (!dataset) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    executeVisualQuery(dataset, mergedQuery)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Query error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataset, mergedQuery]);

  const primaryDim = chart.query.dimensions[0];
  const isKpi = chart.chartType === "kpi";

  return (
    <div className="w-full h-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex flex-col overflow-hidden group">
      {!isKpi && (
        <div
          className={`px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 ${
            editMode ? "drag-handle cursor-grab active:cursor-grabbing bg-slate-50/70 dark:bg-slate-800/40" : ""
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {editMode && <GripHorizontal className="w-4 h-4 text-slate-400 shrink-0" />}
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                {tile.title || chart.name}
              </h3>
              {chart.description && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {chart.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() =>
                echartsRef.current?.exportPng(
                  `${chart.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`
                )
              }
              title="Download PNG"
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <Link
              href={`/explore?chartId=${chart.id}`}
              title="Edit in Chart Studio"
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-600"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            {editMode && (
              <button
                type="button"
                onClick={onRemove}
                title="Remove tile"
                className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {isKpi && editMode && (
        <div className="drag-handle cursor-grab px-3 py-1 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <GripHorizontal className="w-4 h-4 text-slate-400" />
          <button
            type="button"
            onClick={onRemove}
            className="p-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 p-2">
        <ChartView
          ref={echartsRef}
          title={tile.title || chart.name}
          chartType={chart.chartType}
          query={mergedQuery}
          result={result}
          columns={dataset?.columns ?? []}
          formatting={chart.formatting}
          loading={loading}
          error={error}
          compactTable
          onDatumClick={(info) => {
            if (primaryDim && (!primaryDim.dateGranularity || primaryDim.dateGranularity === "raw")) {
              onCrossFilter(primaryDim.column, info.name);
            }
          }}
        />
      </div>
    </div>
  );
}

export function DashboardCanvas({ dashboardId }: { dashboardId: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [chartsMap, setChartsMap] = useState<Map<string, SavedChart>>(new Map());
  const [datasetsMap, setDatasetsMap] = useState<Map<string, Dataset>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);

  // Global filter dropdown values & selections
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [globalFilterValues, setGlobalFilterValues] = useState<Record<string, string>>({});
  const [crossFilter, setCrossFilter] = useState<CrossFilterState | null>(null);

  // Add Tile modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, allCharts, allDatasets] = await Promise.all([
        getDashboard(dashboardId),
        listCharts(),
        listDatasets(),
      ]);
      setDashboard(dash ?? null);
      setChartsMap(new Map(allCharts.map((c) => [c.id, c])));
      const dsMap = new Map(allDatasets.map((d) => [d.id, d]));
      setDatasetsMap(dsMap);

      // Populate global filter options
      if (dash && dash.globalFilters.length > 0) {
        const opts: Record<string, string[]> = {};
        await Promise.all(
          dash.globalFilters.map(async (gf) => {
            const ds = dsMap.get(gf.datasetId);
            if (!ds) return;
            try {
              opts[gf.id] = await fetchDistinctColumnValues(ds, gf.column);
            } catch {
              opts[gf.id] = [];
            }
          })
        );
        setFilterOptions(opts);
      }
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const persistDashboard = async (next: Dashboard) => {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    setDashboard(updated);
    await saveDashboard(updated);
  };

  const handleLayoutChange = (currentLayout: Layout[]) => {
    if (!dashboard || !editMode) return;
    const layoutById = new Map(currentLayout.map((l) => [l.i, l]));
    const nextTiles = dashboard.tiles.map((tile) => {
      const l = layoutById.get(tile.id);
      if (!l) return tile;
      return {
        ...tile,
        layout: {
          ...tile.layout,
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
        },
      };
    });
    persistDashboard({ ...dashboard, tiles: nextTiles });
  };

  const handleAddChartTile = async (chart: SavedChart) => {
    if (!dashboard) return;
    const maxY = dashboard.tiles.reduce(
      (acc, t) => Math.max(acc, t.layout.y + t.layout.h),
      0
    );
    const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
    const nextTile: DashboardTile = {
      id: tileId,
      kind: "chart",
      chartId: chart.id,
      layout: {
        i: tileId,
        x: 0,
        y: maxY,
        w: chart.chartType === "kpi" ? 4 : 6,
        h: chart.chartType === "kpi" ? 3 : 7,
        minW: 3,
        minH: 2,
      },
    };
    await persistDashboard({ ...dashboard, tiles: [...dashboard.tiles, nextTile] });
    setAddModalOpen(false);
  };

  const handleAddMarkdownTile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dashboard || !noteBody.trim()) return;
    const maxY = dashboard.tiles.reduce(
      (acc, t) => Math.max(acc, t.layout.y + t.layout.h),
      0
    );
    const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
    const nextTile: DashboardTile = {
      id: tileId,
      kind: "markdown",
      title: noteTitle.trim() || "Executive Note",
      markdownContent: noteBody.trim(),
      layout: { i: tileId, x: 0, y: maxY, w: 12, h: 3, minW: 3, minH: 2 },
    };
    await persistDashboard({ ...dashboard, tiles: [...dashboard.tiles, nextTile] });
    setNoteTitle("");
    setNoteBody("");
    setAddModalOpen(false);
  };

  const handleRemoveTile = async (tileId: string) => {
    if (!dashboard) return;
    await persistDashboard({
      ...dashboard,
      tiles: dashboard.tiles.filter((t) => t.id !== tileId),
    });
  };

  const handleExportJson = async () => {
    if (!dashboard) return;
    const bundle = await exportDashboardBundle(dashboard.id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dashboard.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.quackboard.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasAnyActiveFilter =
    Boolean(crossFilter) || Object.values(globalFilterValues).some((v) => v !== "");

  if (loading) {
    return (
      <div className="max-w-[1520px] w-full mx-auto px-4 py-8">
        <div className="h-12 w-72 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-36 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-4">
        <h2 className="text-xl font-bold">Dashboard not found</h2>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboards
        </Link>
      </div>
    );
  }

  const gridLayouts = {
    lg: dashboard.tiles.map((t) => t.layout),
    md: dashboard.tiles.map((t) => t.layout),
    sm: dashboard.tiles.map((t, idx) => ({ ...t.layout, x: 0, w: 6, y: idx * 6 })),
  };

  return (
    <div className="max-w-[1560px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
      {/* Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-4 shadow-sm">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            {editMode ? (
              <input
                type="text"
                value={dashboard.name}
                onChange={(e) => persistDashboard({ ...dashboard, name: e.target.value })}
                className="text-lg sm:text-xl font-bold bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            ) : (
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {dashboard.name}
              </h1>
            )}
          </div>
          {dashboard.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 pl-6">
              {dashboard.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Tile
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => setEditMode((e) => !e)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              editMode
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {editMode ? <Save className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
            {editMode ? "Done Editing" : "Edit Layout"}
          </button>
        </div>
      </div>

      {/* Global Filter Bar & Active Cross-Filter Chips */}
      {(dashboard.globalFilters.length > 0 || crossFilter) && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters</span>
          </div>

          {dashboard.globalFilters.map((gf) => (
            <div key={gf.id} className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {gf.label}:
              </label>
              <select
                value={globalFilterValues[gf.id] ?? ""}
                onChange={(e) =>
                  setGlobalFilterValues((prev) => ({ ...prev, [gf.id]: e.target.value }))
                }
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                <option value="">All</option>
                {(filterOptions[gf.id] ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {crossFilter && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-xs">
              <span>
                Cross-filter: {crossFilter.column} = {crossFilter.value}
              </span>
              <button
                type="button"
                onClick={() => setCrossFilter(null)}
                className="hover:bg-blue-700 rounded-full p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setGlobalFilterValues({});
                setCrossFilter(null);
              }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset All
            </button>
          )}
        </div>
      )}

      {/* Grid Canvas */}
      {dashboard.tiles.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 py-20 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            This dashboard has no tiles yet.
          </p>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Your First Chart
          </button>
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout -mx-2"
          layouts={gridLayouts}
          breakpoints={{ lg: 1100, md: 768, sm: 0 }}
          cols={{ lg: 12, md: 12, sm: 6 }}
          rowHeight={44}
          margin={[14, 14]}
          isDraggable={editMode}
          isResizable={editMode}
          draggableHandle=".drag-handle"
          onLayoutChange={handleLayoutChange}
        >
          {dashboard.tiles.map((tile) => {
            if (tile.kind === "markdown") {
              return (
                <div
                  key={tile.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col overflow-hidden"
                >
                  <div
                    className={`flex items-center justify-between mb-2 ${
                      editMode ? "drag-handle cursor-grab" : ""
                    }`}
                  >
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                      {tile.title || "Note"}
                    </h3>
                    {editMode && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTile(tile.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap overflow-auto">
                    {tile.markdownContent}
                  </p>
                </div>
              );
            }

            const chart = tile.chartId ? chartsMap.get(tile.chartId) : undefined;
            if (!chart) {
              return (
                <div
                  key={tile.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-center text-xs text-slate-400"
                >
                  Saved chart no longer exists
                </div>
              );
            }

            const dataset = datasetsMap.get(chart.datasetId);
            const activeFilters: QueryFilter[] = [];

            for (const gf of dashboard.globalFilters) {
              const selected = globalFilterValues[gf.id];
              if (selected && gf.datasetId === chart.datasetId) {
                activeFilters.push({
                  column: gf.column,
                  operator: "eq",
                  value: selected,
                });
              }
            }

            if (
              crossFilter &&
              crossFilter.datasetId === chart.datasetId &&
              crossFilter.sourceChartId !== chart.id
            ) {
              activeFilters.push({
                column: crossFilter.column,
                operator: "eq",
                value: crossFilter.value,
              });
            }

            return (
              <div key={tile.id}>
                <DashboardChartTile
                  tile={tile}
                  chart={chart}
                  dataset={dataset}
                  activeFilters={activeFilters}
                  editMode={editMode}
                  onCrossFilter={(column, value) => {
                    setCrossFilter((prev) =>
                      prev &&
                      prev.column === column &&
                      prev.value === value &&
                      prev.sourceChartId === chart.id
                        ? null
                        : {
                            sourceChartId: chart.id,
                            datasetId: chart.datasetId,
                            column,
                            value,
                          }
                    );
                  }}
                  onRemove={() => handleRemoveTile(tile.id)}
                />
              </div>
            );
          })}
        </ResponsiveGridLayout>
      )}

      {/* Add Tile Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Add Tile to Dashboard
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Saved Charts
                </span>
                <Link
                  href="/explore"
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  + Build New in Studio
                </Link>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl max-h-56 overflow-y-auto">
                {Array.from(chartsMap.values()).map((ch) => (
                  <div
                    key={ch.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{ch.name}</div>
                      <div className="text-xs text-slate-500 capitalize">
                        {ch.chartType.replace("_", " ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddChartTile(ch)}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleAddMarkdownTile}
              className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Add Text / Executive Callout
              </span>
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title (optional)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              />
              <textarea
                rows={3}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write key takeaways or metric definitions..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Add Note Tile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
