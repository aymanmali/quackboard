"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  AreaChart,
  BarChart2,
  BarChart3,
  BarChartHorizontal,
  Calendar,
  Code2,
  Download,
  Filter,
  GripVertical,
  Hash,
  LineChart,
  PieChart,
  Plus,
  Save,
  ScatterChart,
  Sparkles,
  Table2,
  Type,
  X,
  Check,
  TrendingUp,
} from "lucide-react";
import {
  AggregationFn,
  ChartFormatting,
  ChartType,
  ColumnMeta,
  Dashboard,
  Dataset,
  DateGranularity,
  DEFAULT_CHART_FORMATTING,
  FilterOperator,
  NumberFormat,
  QueryFilter,
  QueryResult,
  SavedChart,
  VisualQuery,
} from "@/lib/query/types";
import { executeVisualQuery, fetchDistinctColumnValues } from "@/lib/engines/query-runner";
import {
  getChart,
  listDashboards,
  listDatasets,
  saveChart,
  saveDashboard,
} from "@/lib/storage/indexeddb-store";
import { ChartView } from "../charts/ChartView";
import { EChartsHandle } from "../charts/EChartsRenderer";
import { exportQueryResultToCsv } from "../charts/DataTable";

const CHART_TYPES: Array<{ id: ChartType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "auto", label: "Auto", icon: Sparkles },
  { id: "bar", label: "Bar", icon: BarChart3 },
  { id: "stacked_bar", label: "Stacked", icon: BarChart2 },
  { id: "horizontal_bar", label: "H-Bar", icon: BarChartHorizontal },
  { id: "line", label: "Line", icon: LineChart },
  { id: "area", label: "Area", icon: AreaChart },
  { id: "pie", label: "Donut", icon: PieChart },
  { id: "scatter", label: "Scatter", icon: ScatterChart },
  { id: "kpi", label: "KPI", icon: TrendingUp },
  { id: "table", label: "Table", icon: Table2 },
];

const AGGREGATIONS: Array<{ value: AggregationFn; label: string }> = [
  { value: "sum", label: "SUM" },
  { value: "avg", label: "AVG" },
  { value: "count", label: "COUNT" },
  { value: "count_distinct", label: "COUNTD" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
];

const GRANULARITIES: Array<{ value: DateGranularity; label: string }> = [
  { value: "raw", label: "Raw" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

function DraggableFieldPill({
  col,
  onQuickAdd,
}: {
  col: ColumnMeta;
  onQuickAdd: (col: ColumnMeta) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `field:${col.name}`,
    data: { col },
  });

  const isMeasure = col.role === "measure";
  const Icon = col.type === "date" ? Calendar : col.type === "number" ? Hash : Type;

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium select-none transition-all ${
        isDragging ? "opacity-40" : "opacity-100"
      } ${
        isMeasure
          ? "bg-emerald-50/80 border-emerald-200 text-emerald-900 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:text-emerald-200"
          : "bg-blue-50/80 border-blue-200 text-blue-900 hover:bg-blue-100/80 dark:bg-blue-950/40 dark:border-blue-800/70 dark:text-blue-200"
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className="flex items-center gap-1.5 flex-1 min-w-0 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3 h-3 opacity-45 shrink-0" />
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-75" />
        <span className="truncate">{col.name}</span>
      </div>
      <button
        type="button"
        onClick={() => onQuickAdd(col)}
        title={`Add ${col.name} to shelf`}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-opacity cursor-pointer"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

function ShelfDropZone({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-h-[42px] ${
        isOver
          ? "border-blue-500 bg-blue-50/80 dark:bg-blue-950/50 ring-2 ring-blue-500/20"
          : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      }`}
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 w-24 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        {children}
        {React.Children.count(children) === 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">{hint}</span>
        )}
      </div>
    </div>
  );
}

export function ChartStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chartIdParam = searchParams.get("chartId");
  const datasetIdParam = searchParams.get("datasetId");

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>("");
  const [chartId, setChartId] = useState<string | null>(null);
  const [chartName, setChartName] = useState<string>("Untitled Chart");
  const [chartType, setChartType] = useState<ChartType>("auto");
  const [formatting, setFormatting] = useState<ChartFormatting>(DEFAULT_CHART_FORMATTING);

  const [query, setQuery] = useState<VisualQuery>({
    datasetId: "",
    dimensions: [],
    measures: [],
    colorBy: null,
    filters: [],
    limit: 500,
  });

  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [activeDragCol, setActiveDragCol] = useState<ColumnMeta | null>(null);

  // Filter modal state
  const [filterDraftCol, setFilterDraftCol] = useState<ColumnMeta | null>(null);
  const [filterOperator, setFilterOperator] = useState<FilterOperator>("in");
  const [filterValueText, setFilterValueText] = useState("");
  const [filterDistinctOpts, setFilterDistinctOpts] = useState<string[]>([]);
  const [filterSelectedVals, setFilterSelectedVals] = useState<string[]>([]);

  // Save to dashboard modal
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [selectedDashId, setSelectedDashId] = useState<string>("");
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const chartRef = useRef<EChartsHandle | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId]
  );

  // Initial load of datasets, dashboards, and optional existing chart
  useEffect(() => {
    (async () => {
      const [dsList, dList] = await Promise.all([listDatasets(), listDashboards()]);
      setDatasets(dsList);
      setDashboards(dList);
      if (dList[0]) setSelectedDashId(dList[0].id);

      if (chartIdParam) {
        const existing = await getChart(chartIdParam);
        if (existing) {
          setChartId(existing.id);
          setChartName(existing.name);
          setChartType(existing.chartType);
          setFormatting(existing.formatting);
          setActiveDatasetId(existing.datasetId);
          setQuery(existing.query);
          return;
        }
      }

      const initialDs =
        dsList.find((d) => d.id === datasetIdParam) ?? dsList[0];
      if (initialDs) {
        setActiveDatasetId(initialDs.id);
        const defaultDim =
          initialDs.columns.find((c) => c.type === "string" && !/id$/i.test(c.name)) ??
          initialDs.columns.find((c) => c.role === "dimension");
        const defaultMeasure =
          initialDs.columns.find((c) => c.role === "measure" && /sales|revenue|amount|profit/i.test(c.name)) ??
          initialDs.columns.find((c) => c.role === "measure");
        setQuery({
          datasetId: initialDs.id,
          dimensions: defaultDim
            ? [{ column: defaultDim.name, dateGranularity: defaultDim.type === "date" ? "month" : "raw" }]
            : [],
          measures: defaultMeasure ? [{ column: defaultMeasure.name, aggregation: "sum" }] : [],
          colorBy: null,
          filters: [],
          limit: 500,
        });
      }
    })();
  }, [chartIdParam, datasetIdParam]);

  // Execute query whenever dataset or query AST changes
  const runQuery = useCallback(async () => {
    if (!activeDataset) return;
    setLoading(true);
    setError(null);
    try {
      const res = await executeVisualQuery(activeDataset, {
        ...query,
        datasetId: activeDataset.id,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query execution failed");
    } finally {
      setLoading(false);
    }
  }, [activeDataset, query]);

  useEffect(() => {
    runQuery();
  }, [runQuery]);

  const handleDatasetSwitch = (nextId: string) => {
    const nextDs = datasets.find((d) => d.id === nextId);
    if (!nextDs) return;
    setActiveDatasetId(nextId);
    const defaultDim = nextDs.columns.find((c) => c.role === "dimension");
    const defaultMeasure = nextDs.columns.find((c) => c.role === "measure");
    setQuery({
      datasetId: nextId,
      dimensions: defaultDim
        ? [{ column: defaultDim.name, dateGranularity: defaultDim.type === "date" ? "month" : "raw" }]
        : [],
      measures: defaultMeasure ? [{ column: defaultMeasure.name, aggregation: "sum" }] : [],
      colorBy: null,
      filters: [],
      limit: 500,
    });
  };

  const openFilterBuilder = async (col: ColumnMeta) => {
    setFilterDraftCol(col);
    setFilterValueText("");
    setFilterSelectedVals([]);
    setFilterDistinctOpts([]);
    setFilterOperator(col.type === "number" ? "gte" : "in");

    if (activeDataset && col.type !== "number") {
      try {
        const vals = await fetchDistinctColumnValues(activeDataset, col.name);
        setFilterDistinctOpts(vals);
      } catch {
        setFilterDistinctOpts([]);
      }
    }
  };

  const addFilterFromModal = () => {
    if (!filterDraftCol) return;
    let value: QueryFilter["value"];
    if (filterOperator === "in" || filterOperator === "not_in") {
      if (filterSelectedVals.length === 0) return;
      value = filterSelectedVals;
    } else if (filterDraftCol.type === "number") {
      const num = Number(filterValueText);
      if (Number.isNaN(num)) return;
      value = num;
    } else {
      if (!filterValueText.trim()) return;
      value = filterValueText.trim();
    }

    setQuery((prev) => ({
      ...prev,
      filters: [
        ...prev.filters,
        {
          id: crypto.randomUUID().slice(0, 8),
          column: filterDraftCol.name,
          operator: filterOperator,
          value,
        },
      ],
    }));
    setFilterDraftCol(null);
  };

  const handleQuickAdd = (col: ColumnMeta) => {
    if (col.role === "measure") {
      setQuery((prev) => ({
        ...prev,
        measures: [...prev.measures, { column: col.name, aggregation: "sum" }],
      }));
    } else {
      setQuery((prev) => ({
        ...prev,
        dimensions: [
          { column: col.name, dateGranularity: col.type === "date" ? "month" : "raw" },
        ],
      }));
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const col = event.active.data.current?.col as ColumnMeta | undefined;
    setActiveDragCol(col ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragCol(null);
    const col = event.active.data.current?.col as ColumnMeta | undefined;
    const target = event.over?.id;
    if (!col || !target) return;

    if (target === "shelf-columns") {
      setQuery((prev) => ({
        ...prev,
        dimensions: [
          { column: col.name, dateGranularity: col.type === "date" ? "month" : "raw" },
        ],
      }));
    } else if (target === "shelf-rows") {
      const defaultAgg: AggregationFn = col.type === "number" ? "sum" : "count";
      setQuery((prev) => ({
        ...prev,
        measures: [...prev.measures, { column: col.name, aggregation: defaultAgg }],
      }));
    } else if (target === "shelf-color") {
      setQuery((prev) => ({
        ...prev,
        colorBy: { column: col.name, dateGranularity: col.type === "date" ? "year" : "raw" },
      }));
    } else if (target === "shelf-filters") {
      openFilterBuilder(col);
    }
  };

  const handleSaveChart = async (addToDashboard: boolean) => {
    if (!activeDataset) return;
    const now = new Date().toISOString();
    const id = chartId ?? `chart-${crypto.randomUUID().slice(0, 8)}`;
    const record: SavedChart = {
      id,
      name: chartName.trim() || "Untitled Chart",
      datasetId: activeDataset.id,
      chartType,
      query: { ...query, datasetId: activeDataset.id },
      formatting,
      createdAt: now,
      updatedAt: now,
    };
    await saveChart(record);
    setChartId(id);

    if (addToDashboard && selectedDashId) {
      const targetDash = dashboards.find((d) => d.id === selectedDashId);
      if (targetDash) {
        const alreadyOnDash = targetDash.tiles.some((t) => t.chartId === id);
        if (!alreadyOnDash) {
          const maxY = targetDash.tiles.reduce(
            (acc, t) => Math.max(acc, t.layout.y + t.layout.h),
            0
          );
          const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
          await saveDashboard({
            ...targetDash,
            updatedAt: now,
            tiles: [
              ...targetDash.tiles,
              {
                id: tileId,
                kind: "chart",
                chartId: id,
                layout: {
                  i: tileId,
                  x: 0,
                  y: maxY,
                  w: chartType === "kpi" ? 4 : 6,
                  h: chartType === "kpi" ? 3 : 7,
                  minW: 3,
                  minH: 2,
                },
              },
            ],
          });
        }
        setSaveModalOpen(false);
        router.push(`/dashboards/${selectedDashId}`);
        return;
      }
    }

    setSaveModalOpen(false);
    setSavedToast(`Saved "${record.name}"`);
    setTimeout(() => setSavedToast(null), 2600);
  };

  const dimensions = activeDataset?.columns.filter((c) => c.role === "dimension") ?? [];
  const measures = activeDataset?.columns.filter((c) => c.role === "measure") ?? [];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-3.5rem)] max-w-[1600px] w-full mx-auto">
        {/* LEFT PANE: Data Source & Field Pills */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Data Source
            </label>
            <select
              value={activeDatasetId}
              onChange={(e) => handleDatasetSwitch(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.dialect})
                </option>
              ))}
            </select>
            {activeDataset && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {activeDataset.rowCount.toLocaleString()} rows • Drag fields onto shelves
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-5">
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 px-1">
                Dimensions ({dimensions.length})
              </div>
              <div className="space-y-1">
                {dimensions.map((col) => (
                  <DraggableFieldPill key={col.name} col={col} onQuickAdd={handleQuickAdd} />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 px-1">
                Measures ({measures.length})
              </div>
              <div className="space-y-1">
                {measures.map((col) => (
                  <DraggableFieldPill key={col.name} col={col} onQuickAdd={handleQuickAdd} />
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER WORKSPACE: Shelves + Chart Canvas */}
        <section className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950">
          {/* Top Action Bar */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <input
                type="text"
                value={chartName}
                onChange={(e) => setChartName(e.target.value)}
                aria-label="Chart title"
                className="font-bold text-sm sm:text-base bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none px-1 py-0.5 text-slate-900 dark:text-white w-full max-w-sm"
              />
              {savedToast && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  {savedToast}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {result && (
                <span className="hidden sm:inline-block text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {result.rowCount} rows • {result.executionMs} ms
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowSql((s) => !s)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  showSql
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-600"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                SQL
              </button>
              <button
                type="button"
                onClick={() => chartRef.current?.exportPng(`${chartName.toLowerCase().replace(/\s+/g, "-")}.png`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                PNG
              </button>
              {result && (
                <button
                  type="button"
                  onClick={() => exportQueryResultToCsv(result, `${chartName.toLowerCase().replace(/\s+/g, "-")}.csv`)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  CSV
                </button>
              )}
              <button
                type="button"
                onClick={() => setSaveModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save Chart
              </button>
            </div>
          </div>

          {/* Tableau-Style Shelves */}
          <div className="p-3 space-y-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <ShelfDropZone
                id="shelf-columns"
                label="Columns (X)"
                hint="Drop a dimension or date here..."
              >
                {query.dimensions.map((dim, idx) => {
                  const meta = activeDataset?.columns.find((c) => c.name === dim.column);
                  return (
                    <div
                      key={`${dim.column}-${idx}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-medium shadow-xs"
                    >
                      <span>{dim.column}</span>
                      {meta?.type === "date" && (
                        <select
                          value={dim.dateGranularity ?? "month"}
                          onChange={(e) => {
                            const gran = e.target.value as DateGranularity;
                            setQuery((prev) => ({
                              ...prev,
                              dimensions: prev.dimensions.map((d, i) =>
                                i === idx ? { ...d, dateGranularity: gran } : d
                              ),
                            }));
                          }}
                          className="bg-blue-700 text-white text-[11px] rounded px-1 py-0.5 focus:outline-none cursor-pointer"
                        >
                          {GRANULARITIES.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setQuery((prev) => ({
                            ...prev,
                            dimensions: prev.dimensions.filter((_, i) => i !== idx),
                          }))
                        }
                        className="hover:bg-blue-700 rounded p-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </ShelfDropZone>

              <ShelfDropZone
                id="shelf-rows"
                label="Rows (Y)"
                hint="Drop one or more measures here..."
              >
                {query.measures.map((m, idx) => (
                  <div
                    key={`${m.column}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium shadow-xs"
                  >
                    <select
                      value={m.aggregation}
                      onChange={(e) => {
                        const agg = e.target.value as AggregationFn;
                        setQuery((prev) => ({
                          ...prev,
                          measures: prev.measures.map((item, i) =>
                            i === idx ? { ...item, aggregation: agg } : item
                          ),
                        }));
                      }}
                      className="bg-emerald-700 text-white text-[11px] font-bold rounded px-1 py-0.5 focus:outline-none cursor-pointer"
                    >
                      {AGGREGATIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <span>({m.column})</span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuery((prev) => ({
                          ...prev,
                          measures: prev.measures.filter((_, i) => i !== idx),
                        }))
                      }
                      className="hover:bg-emerald-700 rounded p-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </ShelfDropZone>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <ShelfDropZone
                id="shelf-color"
                label="Color / Group"
                hint="Optional breakdown dimension..."
              >
                {query.colorBy && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium shadow-xs">
                    <span>{query.colorBy.column}</span>
                    <button
                      type="button"
                      onClick={() => setQuery((prev) => ({ ...prev, colorBy: null }))}
                      className="hover:bg-indigo-700 rounded p-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </ShelfDropZone>

              <ShelfDropZone
                id="shelf-filters"
                label="Filters"
                hint="Drop any field here to filter..."
              >
                {query.filters.map((f, idx) => (
                  <div
                    key={f.id ?? idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-medium"
                  >
                    <Filter className="w-3 h-3" />
                    <span>
                      {f.column} {f.operator}{" "}
                      {Array.isArray(f.value) ? f.value.join(", ") : String(f.value)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuery((prev) => ({
                          ...prev,
                          filters: prev.filters.filter((_, i) => i !== idx),
                        }))
                      }
                      className="hover:bg-amber-200 dark:hover:bg-amber-900 rounded p-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </ShelfDropZone>
            </div>
          </div>

          {/* Visualization Canvas */}
          <div className="flex-1 p-4 flex flex-col gap-3 min-h-[440px]">
            <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 min-h-[400px] flex flex-col">
              <div className="flex-1 w-full h-[380px] min-h-[360px]">
                <ChartView
                  ref={chartRef}
                  title={chartName}
                  chartType={chartType}
                  query={query}
                  result={result}
                  columns={activeDataset?.columns ?? []}
                  formatting={formatting}
                  loading={loading}
                  error={error}
                />
              </div>
            </div>

            {showSql && result?.sql && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 p-4 font-mono text-xs overflow-x-auto">
                <div className="flex items-center justify-between mb-2 text-slate-400">
                  <span className="font-semibold uppercase tracking-wider text-[10px]">
                    Compiled SQL ({activeDataset?.dialect})
                  </span>
                  <span>{result.executionMs} ms</span>
                </div>
                <pre className="whitespace-pre-wrap">{result.sql}</pre>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE: Chart Types & Formatting */}
        <aside className="w-full lg:w-64 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-5 overflow-y-auto">
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Visualization
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {CHART_TYPES.map((ct) => {
                const Icon = ct.icon;
                const active = chartType === ct.id;
                return (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => setChartType(ct.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-950/60 dark:border-blue-500 dark:text-blue-300"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{ct.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Formatting
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Color Palette
              </label>
              <select
                value={formatting.palette}
                onChange={(e) =>
                  setFormatting((f) => ({
                    ...f,
                    palette: e.target.value as ChartFormatting["palette"],
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              >
                <option value="tableau">Tableau Classic</option>
                <option value="ocean">Ocean Blue</option>
                <option value="emerald">Emerald Analytical</option>
                <option value="sunset">Sunset Warm</option>
                <option value="mono">Monochrome Slate</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Number Format
              </label>
              <select
                value={formatting.numberFormat}
                onChange={(e) =>
                  setFormatting((f) => ({
                    ...f,
                    numberFormat: e.target.value as NumberFormat,
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              >
                <option value="auto">Auto</option>
                <option value="currency">Currency ($)</option>
                <option value="compact">Compact (1.2K / 3.4M)</option>
                <option value="percent">Percent (%)</option>
                <option value="decimal">Decimal</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Legend Position
              </label>
              <select
                value={formatting.legendPosition}
                onChange={(e) =>
                  setFormatting((f) => ({
                    ...f,
                    legendPosition: e.target.value as ChartFormatting["legendPosition"],
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              >
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
                <option value="right">Right</option>
              </select>
            </div>

            <label className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Show Legend</span>
              <input
                type="checkbox"
                checked={formatting.showLegend}
                onChange={(e) => setFormatting((f) => ({ ...f, showLegend: e.target.checked }))}
                className="rounded border-slate-300"
              />
            </label>

            <label className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Show Data Labels</span>
              <input
                type="checkbox"
                checked={formatting.showDataLabels}
                onChange={(e) => setFormatting((f) => ({ ...f, showDataLabels: e.target.checked }))}
                className="rounded border-slate-300"
              />
            </label>

            <label className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Smooth Curves</span>
              <input
                type="checkbox"
                checked={formatting.smoothLine}
                onChange={(e) => setFormatting((f) => ({ ...f, smoothLine: e.target.checked }))}
                className="rounded border-slate-300"
              />
            </label>
          </div>
        </aside>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeDragCol && (
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg text-white ${
              activeDragCol.role === "measure" ? "bg-emerald-600" : "bg-blue-600"
            }`}
          >
            {activeDragCol.name}
          </div>
        )}
      </DragOverlay>

      {/* Filter Builder Modal */}
      {filterDraftCol && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Filter: <span className="text-blue-600">{filterDraftCol.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setFilterDraftCol(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Operator
                </label>
                <select
                  value={filterOperator}
                  onChange={(e) => setFilterOperator(e.target.value as FilterOperator)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="in">Is any of (IN)</option>
                  <option value="not_in">Is not any of (NOT IN)</option>
                  <option value="eq">Equals (=)</option>
                  <option value="neq">Not equals (!=)</option>
                  <option value="contains">Contains text</option>
                  <option value="gte">Greater than or equal (&gt;=)</option>
                  <option value="lte">Less than or equal (&lt;=)</option>
                </select>
              </div>

              {(filterOperator === "in" || filterOperator === "not_in") &&
              filterDistinctOpts.length > 0 ? (
                <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1">
                  {filterDistinctOpts.map((val) => {
                    const checked = filterSelectedVals.includes(val);
                    return (
                      <label
                        key={val}
                        className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setFilterSelectedVals((prev) =>
                              e.target.checked ? [...prev, val] : prev.filter((v) => v !== val)
                            )
                          }
                        />
                        <span>{val}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Value
                  </label>
                  <input
                    type={filterDraftCol.type === "number" ? "number" : "text"}
                    value={filterValueText}
                    onChange={(e) => setFilterValueText(e.target.value)}
                    placeholder="Enter filter value..."
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFilterDraftCol(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addFilterFromModal}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                Apply Filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Chart Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Save Chart</h3>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Chart Title
                </label>
                <input
                  type="text"
                  value={chartName}
                  onChange={(e) => setChartName(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
              </div>

              {dashboards.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Target Dashboard
                  </label>
                  <select
                    value={selectedDashId}
                    onChange={(e) => setSelectedDashId(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                  >
                    {dashboards.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleSaveChart(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Save Chart Only
              </button>
              <button
                type="button"
                onClick={() => handleSaveChart(true)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Save & Add to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
