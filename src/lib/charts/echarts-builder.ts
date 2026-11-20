import type { EChartsOption, SeriesOption } from "echarts";
import {
  ChartFormatting,
  ChartType,
  ColumnMeta,
  DEFAULT_CHART_FORMATTING,
  NumberFormat,
  QueryResult,
  VisualQuery,
} from "../query/types";
import { getDimensionAlias, getMeasureAlias } from "../query/compiler";

export const COLOR_PALETTES: Record<ChartFormatting["palette"], string[]> = {
  tableau: [
    "#4E79A7",
    "#F28E2B",
    "#E15759",
    "#76B7B2",
    "#59A14F",
    "#EDC948",
    "#B07AA1",
    "#FF9DA7",
    "#9C755F",
    "#BAB0AC",
  ],
  ocean: ["#0284C7", "#0EA5E9", "#38BDF8", "#0369A1", "#14B8A6", "#6366F1", "#8B5CF6"],
  emerald: ["#059669", "#10B981", "#34D399", "#0D9488", "#0284C7", "#F59E0B", "#EF4444"],
  sunset: ["#EA580C", "#F97316", "#F59E0B", "#E11D48", "#9333EA", "#2563EB", "#14B8A6"],
  mono: ["#0F172A", "#334155", "#475569", "#64748B", "#94A3B8", "#CBD5E1"],
};

export function formatNumericValue(value: unknown, format: NumberFormat = "auto"): string {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return String(value ?? "");
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return String(value);
  }

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(num) >= 1000 ? 0 : 2,
      }).format(num);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(num);
    case "compact":
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(num);
    case "decimal":
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
      }).format(num);
    case "auto":
    default:
      if (Math.abs(num) >= 1_000_000) {
        return new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 2,
        }).format(num);
      }
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(num) >= 100 ? 0 : 2,
      }).format(num);
  }
}

/**
 * Recommends the best visual chart type based on query structure and column metadata.
 */
export function resolveChartType(
  requested: ChartType,
  query: VisualQuery,
  columns: ColumnMeta[]
): Exclude<ChartType, "auto"> {
  if (requested !== "auto") return requested;

  const dims = query.dimensions.length;
  const measures = query.measures.length;

  if (dims === 0 && measures === 1) return "kpi";
  if (dims === 0 && measures === 2) return "scatter";
  if (dims === 0) return "table";

  const firstDim = columns.find((c) => c.name === query.dimensions[0]?.column);
  if (firstDim?.type === "date") {
    return query.colorBy ? "line" : "area";
  }
  if (query.colorBy) {
    return "stacked_bar";
  }
  if (measures === 0) return "table";
  return "bar";
}

export function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildEChartsOption(params: {
  chartType: ChartType;
  query: VisualQuery;
  result: QueryResult;
  columns: ColumnMeta[];
  formatting?: Partial<ChartFormatting>;
  theme: "light" | "dark";
}): EChartsOption {
  const { query, result, columns, theme } = params;
  const fmt: ChartFormatting = { ...DEFAULT_CHART_FORMATTING, ...params.formatting };
  const resolvedType = resolveChartType(params.chartType, query, columns);
  const colors = COLOR_PALETTES[fmt.palette] ?? COLOR_PALETTES.tableau;

  const isDark = theme === "dark";
  const textColor = isDark ? "#E2E8F0" : "#1E293B";
  const subTextColor = isDark ? "#94A3B8" : "#64748B";
  const gridLineColor = isDark ? "rgba(148, 163, 184, 0.14)" : "rgba(148, 163, 184, 0.25)";
  const tooltipBg = isDark ? "#0F172A" : "#FFFFFF";
  const tooltipBorder = isDark ? "#334155" : "#E2E8F0";

  const xKey = query.dimensions[0]
    ? getDimensionAlias(query.dimensions[0])
    : result.columns[0];
  const colorKey = query.colorBy ? getDimensionAlias(query.colorBy) : undefined;
  const measureKeys =
    query.measures.length > 0
      ? query.measures.map(getMeasureAlias)
      : result.columns.filter((c) => c !== xKey && c !== colorKey);

  const legendConfig = fmt.showLegend
    ? {
        show: true,
        textStyle: { color: subTextColor, fontSize: 12 },
        ...(fmt.legendPosition === "top"
          ? { top: 4, left: "center" }
          : fmt.legendPosition === "right"
          ? { right: 8, top: "middle", orient: "vertical" as const }
          : { bottom: 4, left: "center" }),
      }
    : { show: false };

  const baseOption: EChartsOption = {
    color: colors,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
      color: textColor,
    },
    tooltip: {
      trigger: resolvedType === "pie" || resolvedType === "scatter" ? "item" : "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: 12 },
      axisPointer: {
        type: resolvedType === "line" || resolvedType === "area" ? "line" : "shadow",
      },
    },
    legend: legendConfig,
  };

  // PIE / DONUT
  if (resolvedType === "pie") {
    const valueKey = measureKeys[0] ?? result.columns[1] ?? result.columns[0];
    const data = result.rows.map((row) => ({
      name: String(row[xKey] ?? "Unknown"),
      value: Number(row[valueKey] ?? 0),
    }));

    return {
      ...baseOption,
      tooltip: {
        ...baseOption.tooltip,
        formatter: (p: unknown) => {
          const item = p as { name?: string; value?: number; percent?: number; marker?: string };
          return `${item.marker ?? ""} <strong>${item.name ?? ""}</strong><br/>${humanizeFieldName(
            valueKey
          )}: ${formatNumericValue(item.value, fmt.numberFormat)} (${item.percent ?? 0}%)`;
        },
      },
      series: [
        {
          name: humanizeFieldName(valueKey),
          type: "pie",
          radius: ["42%", "72%"],
          center: fmt.legendPosition === "right" ? ["40%", "50%"] : ["50%", "47%"],
          itemStyle: {
            borderRadius: 6,
            borderColor: isDark ? "#0F172A" : "#FFFFFF",
            borderWidth: 2,
          },
          label: {
            show: fmt.showDataLabels,
            color: textColor,
            formatter: "{b}: {d}%",
          },
          data,
        },
      ],
    };
  }

  // SCATTER
  if (resolvedType === "scatter") {
    const xMetric = measureKeys[0] ?? result.columns[0];
    const yMetric = measureKeys[1] ?? measureKeys[0] ?? result.columns[1];
    const labelKey = query.dimensions[0] ? xKey : undefined;

    if (colorKey) {
      const groups = new Map<string, Array<[number, number, string]>>();
      for (const row of result.rows) {
        const group = String(row[colorKey] ?? "Other");
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push([
          Number(row[xMetric] ?? 0),
          Number(row[yMetric] ?? 0),
          labelKey ? String(row[labelKey] ?? "") : group,
        ]);
      }

      const series: SeriesOption[] = Array.from(groups.entries()).map(([name, pts]) => ({
        name,
        type: "scatter",
        symbolSize: 11,
        data: pts,
      }));

      return {
        ...baseOption,
        grid: { left: 56, right: 24, top: 28, bottom: fmt.showLegend ? 48 : 32, containLabel: true },
        xAxis: {
          type: "value",
          name: fmt.xAxisLabel || humanizeFieldName(xMetric),
          nameLocation: "middle",
          nameGap: 26,
          axisLabel: { color: subTextColor, formatter: (v: number) => formatNumericValue(v, fmt.numberFormat) },
          splitLine: { lineStyle: { color: gridLineColor } },
        },
        yAxis: {
          type: "value",
          name: fmt.yAxisLabel || humanizeFieldName(yMetric),
          axisLabel: { color: subTextColor, formatter: (v: number) => formatNumericValue(v, fmt.numberFormat) },
          splitLine: { lineStyle: { color: gridLineColor } },
        },
        series,
      };
    }

    return {
      ...baseOption,
      grid: { left: 56, right: 24, top: 28, bottom: 36, containLabel: true },
      xAxis: {
        type: "value",
        name: fmt.xAxisLabel || humanizeFieldName(xMetric),
        nameLocation: "middle",
        nameGap: 26,
        axisLabel: { color: subTextColor, formatter: (v: number) => formatNumericValue(v, fmt.numberFormat) },
        splitLine: { lineStyle: { color: gridLineColor } },
      },
      yAxis: {
        type: "value",
        name: fmt.yAxisLabel || humanizeFieldName(yMetric),
        axisLabel: { color: subTextColor, formatter: (v: number) => formatNumericValue(v, fmt.numberFormat) },
        splitLine: { lineStyle: { color: gridLineColor } },
      },
      series: [
        {
          name: `${humanizeFieldName(xMetric)} vs ${humanizeFieldName(yMetric)}`,
          type: "scatter",
          symbolSize: 11,
          data: result.rows.map((r) => [
            Number(r[xMetric] ?? 0),
            Number(r[yMetric] ?? 0),
            labelKey ? String(r[labelKey] ?? "") : "",
          ]),
        },
      ],
    };
  }

  // CARTESIAN CHARTS: bar, stacked_bar, horizontal_bar, line, area
  const categories = Array.from(new Set(result.rows.map((r) => String(r[xKey] ?? ""))));
  const isHorizontal = resolvedType === "horizontal_bar";
  const isStacked = resolvedType === "stacked_bar";
  const isLine = resolvedType === "line" || resolvedType === "area";
  const isArea = resolvedType === "area";

  const series: SeriesOption[] = [];

  if (colorKey && measureKeys.length >= 1) {
    const primaryMeasure = measureKeys[0];
    const groups = Array.from(new Set(result.rows.map((r) => String(r[colorKey] ?? "Other"))));
    const lookup = new Map<string, number>();

    for (const row of result.rows) {
      const key = `${String(row[xKey] ?? "")}|||${String(row[colorKey] ?? "Other")}`;
      lookup.set(key, Number(row[primaryMeasure] ?? 0));
    }

    for (const grp of groups) {
      const data = categories.map((cat) => lookup.get(`${cat}|||${grp}`) ?? 0);
      series.push({
        name: grp,
        type: isLine ? "line" : "bar",
        stack: isStacked || isArea ? "total" : undefined,
        smooth: isLine ? fmt.smoothLine : undefined,
        areaStyle: isArea ? { opacity: 0.22 } : undefined,
        emphasis: { focus: "series" },
        barMaxWidth: 44,
        itemStyle: !isLine ? { borderRadius: isStacked ? 0 : isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
        label: fmt.showDataLabels
          ? {
              show: true,
              position: isHorizontal ? "right" : "top",
              color: subTextColor,
              fontSize: 11,
              formatter: (p: unknown) => formatNumericValue((p as { value?: number }).value, fmt.numberFormat),
            }
          : undefined,
        data,
      });
    }
  } else {
    for (const mKey of measureKeys) {
      const lookup = new Map<string, number>();
      for (const row of result.rows) {
        lookup.set(String(row[xKey] ?? ""), Number(row[mKey] ?? 0));
      }
      const data = categories.map((cat) => lookup.get(cat) ?? 0);

      series.push({
        name: humanizeFieldName(mKey),
        type: isLine ? "line" : "bar",
        stack: isStacked ? "total" : undefined,
        smooth: isLine ? fmt.smoothLine : undefined,
        areaStyle: isArea ? { opacity: 0.24 } : undefined,
        barMaxWidth: 48,
        itemStyle: !isLine ? { borderRadius: isStacked ? 0 : isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
        label: fmt.showDataLabels
          ? {
              show: true,
              position: isHorizontal ? "right" : "top",
              color: subTextColor,
              fontSize: 11,
              formatter: (p: unknown) => formatNumericValue((p as { value?: number }).value, fmt.numberFormat),
            }
          : undefined,
        data,
      });
    }
  }

  const categoryAxis = {
    type: "category" as const,
    data: categories,
    name: isHorizontal ? fmt.yAxisLabel : fmt.xAxisLabel,
    axisLine: { lineStyle: { color: gridLineColor } },
    axisTick: { show: false },
    axisLabel: {
      color: subTextColor,
      fontSize: 11,
      rotate: !isHorizontal && categories.length > 10 ? 30 : 0,
      overflow: "truncate" as const,
      width: 96,
    },
  };

  const valueAxis = {
    type: "value" as const,
    name: isHorizontal ? fmt.xAxisLabel : fmt.yAxisLabel,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: gridLineColor } },
    axisLabel: {
      color: subTextColor,
      fontSize: 11,
      formatter: (val: number) => formatNumericValue(val, fmt.numberFormat),
    },
  };

  return {
    ...baseOption,
    grid: {
      left: 16,
      right: fmt.legendPosition === "right" && fmt.showLegend ? 120 : 20,
      top: fmt.legendPosition === "top" && fmt.showLegend ? 42 : 24,
      bottom: fmt.legendPosition === "bottom" && fmt.showLegend ? 44 : 20,
      containLabel: true,
    },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series,
  };
}
