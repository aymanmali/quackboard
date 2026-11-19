"use client";

import React from "react";
import { TrendingUp } from "lucide-react";
import { COLOR_PALETTES, formatNumericValue, humanizeFieldName } from "@/lib/charts/echarts-builder";
import { ChartFormatting, QueryResult } from "@/lib/query/types";

interface KpiCardProps {
  title?: string;
  result: QueryResult;
  formatting: ChartFormatting;
}

export function KpiCard({ title, result, formatting }: KpiCardProps) {
  const firstCol = result.columns[0];
  const rawVal = result.rows[0]?.[firstCol];
  const formatted = formatNumericValue(rawVal, formatting.numberFormat);
  const accentColor = COLOR_PALETTES[formatting.palette]?.[0] ?? "#4E79A7";

  return (
    <div className="w-full h-full flex flex-col justify-center px-5 py-3 relative overflow-hidden">
      <div
        className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full"
        style={{ backgroundColor: accentColor }}
      />
      <div className="flex items-center justify-between gap-2 pl-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title || humanizeFieldName(firstCol ?? "Metric")}
        </span>
        <TrendingUp className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
      </div>
      <div className="pl-2 mt-1.5 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white truncate">
        {formatted}
      </div>
      <div className="pl-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
        {humanizeFieldName(firstCol ?? "value")} • {result.executionMs} ms
      </div>
    </div>
  );
}
