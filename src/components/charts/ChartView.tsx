"use client";

import React, { useMemo, forwardRef } from "react";
import { AlertCircle, BarChart3, Loader2 } from "lucide-react";
import { buildEChartsOption, resolveChartType } from "@/lib/charts/echarts-builder";
import {
  ChartFormatting,
  ChartType,
  ColumnMeta,
  DEFAULT_CHART_FORMATTING,
  QueryResult,
  VisualQuery,
} from "@/lib/query/types";
import { useTheme } from "../ThemeProvider";
import { DataTable } from "./DataTable";
import { EChartsHandle, EChartsRenderer } from "./EChartsRenderer";
import { KpiCard } from "./KpiCard";

interface ChartViewProps {
  title?: string;
  chartType: ChartType;
  query: VisualQuery;
  result: QueryResult | null;
  columns: ColumnMeta[];
  formatting?: Partial<ChartFormatting>;
  loading?: boolean;
  error?: string | null;
  compactTable?: boolean;
  onDatumClick?: (info: { name: string; seriesName?: string; value?: unknown }) => void;
}

export const ChartView = forwardRef<EChartsHandle, ChartViewProps>(function ChartView(
  {
    title,
    chartType,
    query,
    result,
    columns,
    formatting,
    loading,
    error,
    compactTable = false,
    onDatumClick,
  },
  ref
) {
  const { theme } = useTheme();
  const mergedFormatting = useMemo(
    () => ({ ...DEFAULT_CHART_FORMATTING, ...formatting }),
    [formatting]
  );

  const resolvedType = useMemo(
    () => resolveChartType(chartType, query, columns),
    [chartType, query, columns]
  );

  const echartsOption = useMemo(() => {
    if (!result || result.rows.length === 0) return null;
    if (resolvedType === "kpi" || resolvedType === "table") return null;
    return buildEChartsOption({
      chartType: resolvedType,
      query,
      result,
      columns,
      formatting: mergedFormatting,
      theme,
    });
  }, [resolvedType, query, result, columns, mergedFormatting, theme]);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="text-xs font-medium">Running analytical query...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center gap-2">
        <AlertCircle className="w-6 h-6 text-rose-500" />
        <p className="text-xs font-medium text-rose-600 dark:text-rose-400 max-w-md">{error}</p>
      </div>
    );
  }

  if (!result || result.rows.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-2 text-slate-400">
        <BarChart3 className="w-8 h-8 opacity-40" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          No matching data to visualize
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Drag dimensions & measures onto the shelves above or adjust active filters.
        </p>
      </div>
    );
  }

  if (resolvedType === "kpi") {
    return <KpiCard title={title} result={result} formatting={mergedFormatting} />;
  }

  if (resolvedType === "table") {
    return (
      <DataTable
        result={result}
        numberFormat={mergedFormatting.numberFormat}
        compact={compactTable}
      />
    );
  }

  if (!echartsOption) return null;

  return <EChartsRenderer ref={ref} option={echartsOption} onDatumClick={onDatumClick} />;
});
