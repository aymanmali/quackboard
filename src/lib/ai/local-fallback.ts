import { compileVisualQuery, getMeasureAlias } from "../query/compiler";
import {
  AggregationFn,
  ChartFormatting,
  ChartType,
  ColumnMeta,
  Dataset,
  DateGranularity,
  QueryResult,
  VisualQuery,
} from "../query/types";
import { validateReadOnlySql } from "../query/validator";
import {
  AskChartResponse,
  AutoDashboardChartSpec,
  AutoDashboardResponse,
  InsightsResponse,
  SqlCopilotResponse,
} from "./types";

const COLUMN_SYNONYMS: Record<string, string[]> = {
  revenue: ["sales", "amount", "total", "income", "gmv", "price"],
  sales: ["revenue", "amount", "total", "turnover"],
  profit: ["margin", "net_income", "earnings", "gain"],
  orders: ["order_id", "transactions", "purchases", "count"],
  customers: ["customer_id", "segment", "client", "user"],
  date: ["order_date", "created_at", "timestamp", "time", "day"],
  location: ["region", "country", "state", "city", "area"],
  product: ["sub_category", "category", "item", "sku"],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function matchColumns(prompt: string, columns: ColumnMeta[]): ColumnMeta[] {
  const lower = prompt.toLowerCase();
  const promptTokens = new Set(tokenize(prompt));
  const scored: Array<{ col: ColumnMeta; score: number }> = [];

  for (const col of columns) {
    const colLower = col.name.toLowerCase();
    const colPhrase = colLower.replace(/_/g, " ");
    let score = 0;

    if (lower.includes(colLower) || lower.includes(colPhrase)) {
      score += 10;
    }

    const colTokens = tokenize(col.name);
    for (const t of colTokens) {
      if (t.length > 2 && promptTokens.has(t)) score += 4;
      if (t.length > 3 && Array.from(promptTokens).some((pt) => pt.startsWith(t) || t.startsWith(pt))) {
        score += 2;
      }
    }

    for (const [synKey, targets] of Object.entries(COLUMN_SYNONYMS)) {
      if (promptTokens.has(synKey) && targets.some((tgt) => colLower.includes(tgt))) {
        score += 5;
      }
    }

    if (score > 0) {
      scored.push({ col, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.col);
}

function inferNumberFormat(measureCols: ColumnMeta[], agg: AggregationFn): ChartFormatting["numberFormat"] {
  if (agg === "count" || agg === "count_distinct") return "auto";
  const first = measureCols[0]?.name.toLowerCase() ?? "";
  if (/(sales|revenue|profit|price|cost|amount|budget|income)/.test(first)) return "currency";
  if (/(rate|ratio|pct|percent|margin|discount)/.test(first)) return "percent";
  return "compact";
}

export function localAskToChart(prompt: string, dataset: Dataset): AskChartResponse {
  const lower = prompt.toLowerCase();
  const matched = matchColumns(prompt, dataset.columns);

  // Detect requested chart type
  let chartType: ChartType = "auto";
  if (/\b(pie|donut|share|proportion|percentage)\b/.test(lower)) chartType = "pie";
  else if (/\bstacked\b/.test(lower)) chartType = "stacked_bar";
  else if (/\b(horizontal|h-bar|ranking|top\s+\d+)\b/.test(lower)) chartType = "horizontal_bar";
  else if (/\barea\b/.test(lower)) chartType = "area";
  else if (/\b(line|trend|over time|monthly|quarterly|yearly|weekly|daily)\b/.test(lower)) chartType = "line";
  else if (/\b(scatter|correlation|vs\.?|versus)\b/.test(lower)) chartType = "scatter";
  else if (/\b(kpi|single number|total\s+\w+\s+only|metric card)\b/.test(lower)) chartType = "kpi";
  else if (/\b(table|rows|raw data|list)\b/.test(lower)) chartType = "table";
  else if (/\bbar\b/.test(lower)) chartType = "bar";

  // Detect aggregation
  let aggregation: AggregationFn = "sum";
  if (/\b(avg|average|mean)\b/.test(lower)) aggregation = "avg";
  else if (/\b(unique|distinct|countd)\b/.test(lower)) aggregation = "count_distinct";
  else if (/\b(count|how many|number of)\b/.test(lower)) aggregation = "count";
  else if (/\b(min|minimum|lowest)\b/.test(lower)) aggregation = "min";
  else if (/\b(max|maximum|highest)\b/.test(lower)) aggregation = "max";

  // Detect date granularity
  let dateGranularity: DateGranularity = "month";
  if (/\b(day|daily)\b/.test(lower)) dateGranularity = "day";
  else if (/\b(week|weekly)\b/.test(lower)) dateGranularity = "week";
  else if (/\b(quarter|quarterly)\b/.test(lower)) dateGranularity = "quarter";
  else if (/\b(year|yearly|annual)\b/.test(lower)) dateGranularity = "year";

  // Detect top-N limit
  const topMatch = lower.match(/\b(?:top|bottom|first)\s+(\d{1,3})\b/);
  const limit = topMatch ? Math.min(Math.max(1, Number(topMatch[1])), 500) : 500;
  const sortDir: "asc" | "desc" = /\b(bottom|lowest|worst|smallest)\b/.test(lower) ? "asc" : "desc";

  // Pick dimensions and measures from matched columns
  const matchedDims = matched.filter((c) => c.role === "dimension");
  const matchedMeasures = matched.filter((c) => c.role === "measure");

  const dateCol =
    matchedDims.find((c) => c.type === "date") ??
    (/\b(trend|over time|monthly|quarterly|yearly|weekly|daily|timeline)\b/.test(lower)
      ? dataset.columns.find((c) => c.type === "date")
      : undefined);

  const fallbackDim =
    dataset.columns.find((c) => c.role === "dimension" && c.type === "string" && !/id$/i.test(c.name)) ??
    dataset.columns.find((c) => c.role === "dimension");

  const fallbackMeasure =
    dataset.columns.find((c) => c.role === "measure" && /sales|revenue|amount|profit/i.test(c.name)) ??
    dataset.columns.find((c) => c.role === "measure");

  const primaryDim = dateCol ?? matchedDims[0] ?? (chartType === "kpi" ? undefined : fallbackDim);
  const secondaryDim =
    matchedDims.find((d) => d.name !== primaryDim?.name && d.type !== "date") ?? null;

  const selectedMeasures =
    matchedMeasures.length > 0
      ? matchedMeasures.slice(0, chartType === "scatter" ? 2 : 2)
      : fallbackMeasure
      ? [fallbackMeasure]
      : [];

  // For count/count_distinct on an ID dimension when no numeric measure matched
  const measures: VisualQuery["measures"] =
    selectedMeasures.length > 0
      ? selectedMeasures.map((m) => ({
          column: m.name,
          aggregation: chartType === "scatter" ? "avg" : aggregation,
        }))
      : primaryDim
      ? [{ column: primaryDim.name, aggregation: "count" }]
      : [];

  const dimensions: VisualQuery["dimensions"] =
    chartType === "kpi" || !primaryDim
      ? []
      : [
          {
            column: primaryDim.name,
            dateGranularity: primaryDim.type === "date" ? dateGranularity : "raw",
          },
        ];

  const colorBy =
    secondaryDim && chartType !== "kpi" && chartType !== "pie" && chartType !== "horizontal_bar"
      ? {
          column: secondaryDim.name,
          dateGranularity: secondaryDim.type === "date" ? ("year" as const) : ("raw" as const),
        }
      : null;

  if (chartType === "auto") {
    if (dimensions.length === 0 && measures.length === 1) chartType = "kpi";
    else if (primaryDim?.type === "date") chartType = colorBy ? "line" : "area";
    else if (colorBy) chartType = "stacked_bar";
    else chartType = "bar";
  }

  const sort =
    measures.length > 0 && primaryDim?.type !== "date"
      ? [{ field: getMeasureAlias(measures[0]), direction: sortDir }]
      : undefined;

  const query: VisualQuery = {
    datasetId: dataset.id,
    dimensions,
    measures,
    colorBy,
    filters: [],
    sort,
    limit,
  };

  const measureNames = measures.map((m) => `${m.aggregation.toUpperCase()}(${m.column})`).join(" & ");
  const title =
    dimensions.length > 0
      ? `${measureNames} by ${dimensions[0].column}${colorBy ? ` & ${colorBy.column}` : ""}`
      : `${measureNames}`;

  const numberFormat = inferNumberFormat(selectedMeasures, aggregation);

  return {
    title: title.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    explanation: `Built ${chartType.replace("_", " ")} visualization from "${dataset.name}" using ${
      dimensions.length > 0 ? dimensions.map((d) => d.column).join(", ") : "overall totals"
    } and ${measureNames || "row records"}.`,
    chartType,
    query,
    formatting: {
      palette: "tableau",
      showLegend: Boolean(colorBy) || measures.length > 1 || chartType === "pie",
      legendPosition: "bottom",
      numberFormat,
      showDataLabels: chartType === "pie" || chartType === "horizontal_bar",
      smoothLine: true,
    },
    engine: "Built-in Local AI",
  };
}

export function localGenerateDashboard(dataset: Dataset, goal?: string): AutoDashboardResponse {
  const measures = dataset.columns.filter((c) => c.role === "measure");
  const stringDims = dataset.columns.filter(
    (c) => c.role === "dimension" && c.type === "string" && !/id$/i.test(c.name)
  );
  const dateDim = dataset.columns.find((c) => c.type === "date");

  const primaryMeasure =
    measures.find((m) => /sales|revenue|amount|total/i.test(m.name)) ?? measures[0];
  const secondaryMeasure =
    measures.find((m) => m.name !== primaryMeasure?.name && /profit|margin|net_income/i.test(m.name)) ??
    measures.find((m) => m.name !== primaryMeasure?.name && /qty|quantity|score/i.test(m.name)) ??
    measures[1];
  const idDim = dataset.columns.find((c) => /id$/i.test(c.name)) ?? dataset.columns[0];

  const charts: AutoDashboardChartSpec[] = [];

  if (primaryMeasure) {
    charts.push({
      title: `Total ${primaryMeasure.name.replace(/_/g, " ")}`.replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Cumulative ${primaryMeasure.name}`,
      chartType: "kpi",
      query: {
        datasetId: dataset.id,
        dimensions: [],
        measures: [{ column: primaryMeasure.name, aggregation: "sum" }],
        filters: [],
        limit: 1,
      },
      formatting: { palette: "tableau", numberFormat: inferNumberFormat([primaryMeasure], "sum"), showLegend: false },
    });
  }

  if (secondaryMeasure) {
    charts.push({
      title: `Total ${secondaryMeasure.name.replace(/_/g, " ")}`.replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Cumulative ${secondaryMeasure.name}`,
      chartType: "kpi",
      query: {
        datasetId: dataset.id,
        dimensions: [],
        measures: [{ column: secondaryMeasure.name, aggregation: "sum" }],
        filters: [],
        limit: 1,
      },
      formatting: { palette: "emerald", numberFormat: inferNumberFormat([secondaryMeasure], "sum"), showLegend: false },
    });
  }

  if (idDim) {
    charts.push({
      title: "Total Records",
      description: `Distinct ${idDim.name}`,
      chartType: "kpi",
      query: {
        datasetId: dataset.id,
        dimensions: [],
        measures: [{ column: idDim.name, aggregation: "count_distinct" }],
        filters: [],
        limit: 1,
      },
      formatting: { palette: "ocean", numberFormat: "auto", showLegend: false },
    });
  }

  if (dateDim && primaryMeasure) {
    const trendMeasures: VisualQuery["measures"] = [{ column: primaryMeasure.name, aggregation: "sum" }];
    if (secondaryMeasure) trendMeasures.push({ column: secondaryMeasure.name, aggregation: "sum" });
    charts.push({
      title: `Monthly ${primaryMeasure.name.replace(/_/g, " ")} Trend`.replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "Time-series trajectory",
      chartType: "area",
      query: {
        datasetId: dataset.id,
        dimensions: [{ column: dateDim.name, dateGranularity: "month" }],
        measures: trendMeasures,
        filters: [],
        limit: 200,
      },
      formatting: { palette: "tableau", numberFormat: inferNumberFormat([primaryMeasure], "sum"), showLegend: true, legendPosition: "top" },
    });
  }

  const dim1 = stringDims[0];
  const dim2 = stringDims[1];
  const dim3 = stringDims[2];

  if (dim1 && primaryMeasure) {
    charts.push({
      title: `${primaryMeasure.name} by ${dim1.name}`.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: dim2 ? `Grouped by ${dim2.name}` : `Breakdown across ${dim1.name}`,
      chartType: dim2 ? "stacked_bar" : "bar",
      query: {
        datasetId: dataset.id,
        dimensions: [{ column: dim1.name }],
        measures: [{ column: primaryMeasure.name, aggregation: "sum" }],
        colorBy: dim2 ? { column: dim2.name } : null,
        filters: [],
        sort: [{ field: `sum_${primaryMeasure.name}`, direction: "desc" }],
        limit: 25,
      },
      formatting: { palette: "tableau", numberFormat: inferNumberFormat([primaryMeasure], "sum"), showLegend: Boolean(dim2) },
    });
  }

  if (dim2 && primaryMeasure) {
    charts.push({
      title: `Share by ${dim2.name}`.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "Click any slice to cross-filter",
      chartType: "pie",
      query: {
        datasetId: dataset.id,
        dimensions: [{ column: dim2.name }],
        measures: [{ column: primaryMeasure.name, aggregation: "sum" }],
        filters: [],
        sort: [{ field: `sum_${primaryMeasure.name}`, direction: "desc" }],
        limit: 12,
      },
      formatting: { palette: "ocean", numberFormat: inferNumberFormat([primaryMeasure], "sum"), showDataLabels: true },
    });
  }

  const rankDim = dim3 ?? dim1;
  const rankMeasure = secondaryMeasure ?? primaryMeasure;
  if (rankDim && rankMeasure) {
    charts.push({
      title: `Top 10 ${rankDim.name} by ${rankMeasure.name}`.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "Top performing segments",
      chartType: "horizontal_bar",
      query: {
        datasetId: dataset.id,
        dimensions: [{ column: rankDim.name }],
        measures: [{ column: rankMeasure.name, aggregation: "sum" }],
        filters: [],
        sort: [{ field: `sum_${rankMeasure.name}`, direction: "desc" }],
        limit: 10,
      },
      formatting: { palette: "emerald", numberFormat: inferNumberFormat([rankMeasure], "sum"), showDataLabels: true, showLegend: false },
    });
  }

  return {
    name: goal?.trim() ? `${dataset.name} — ${goal.trim().slice(0, 40)}` : `${dataset.name} AI Overview`,
    description: goal?.trim()
      ? `AI-generated dashboard tailored to: "${goal.trim()}". Click any chart to cross-filter.`
      : `Automatically synthesized KPIs and interactive visualizations for ${dataset.name}.`,
    charts: charts.slice(0, 7),
    globalFilterColumns: stringDims.slice(0, 3).map((d) => d.name),
    engine: "Built-in Local AI",
  };
}

export function localExplainInsights(title: string, result: QueryResult): InsightsResponse {
  const rows = result.rows ?? [];
  const cols = result.columns ?? [];

  if (rows.length === 0 || cols.length === 0) {
    return {
      headline: `No data returned for "${title}"`,
      summary: "The active query returned zero rows. Relax filters or check selected dimensions.",
      bullets: ["0 rows matched the current filter criteria."],
      anomalies: [],
      followUpQuestions: [
        "Show overall totals without filters",
        "Show top 10 records as a table",
      ],
      engine: "Built-in Local AI",
    };
  }

  const sample = rows[0];
  const numericCols = cols.filter((c) => typeof sample[c] === "number" && !Number.isNaN(Number(sample[c])));
  const labelCols = cols.filter((c) => !numericCols.includes(c));

  const primaryNum = numericCols[0];
  const primaryLabel = labelCols[0];

  const bullets: string[] = [];
  const anomalies: string[] = [];

  if (primaryNum) {
    const values = rows
      .map((r, i) => ({
        label: primaryLabel ? String(r[primaryLabel] ?? `Row ${i + 1}`) : `Row ${i + 1}`,
        val: Number(r[primaryNum] ?? 0),
      }))
      .filter((x) => Number.isFinite(x.val));

    const total = values.reduce((acc, x) => acc + x.val, 0);
    const avg = values.length > 0 ? total / values.length : 0;
    const sorted = [...values].sort((a, b) => b.val - a.val);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];

    const fmt = (n: number) =>
      Math.abs(n) >= 1000
        ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

    bullets.push(
      `Analyzed ${rows.length} rows across ${primaryNum.replace(/_/g, " ")}: total is ${fmt(total)} with an average of ${fmt(avg)} per entry.`
    );

    if (top && primaryLabel) {
      const share = total > 0 ? ((top.val / total) * 100).toFixed(1) : null;
      bullets.push(
        `Top performer is "${top.label}" at ${fmt(top.val)}${share ? ` (${share}% of total)` : ""}.`
      );
      if (share && Number(share) >= 45 && values.length >= 3) {
        anomalies.push(
          `High concentration: "${top.label}" alone accounts for ${share}% of ${primaryNum.replace(/_/g, " ")}.`
        );
      }
    }

    if (bottom && top && bottom.label !== top.label && primaryLabel) {
      bullets.push(`Lowest entry is "${bottom.label}" at ${fmt(bottom.val)}.`);
      if (bottom.val < 0) {
        anomalies.push(`Negative value detected: "${bottom.label}" is at ${fmt(bottom.val)}.`);
      }
    }

    if (values.length >= 3 && primaryLabel && /date|month|year|quarter|week/i.test(primaryLabel)) {
      const first = values[0];
      const last = values[values.length - 1];
      if (first.val !== 0) {
        const pct = (((last.val - first.val) / Math.abs(first.val)) * 100).toFixed(1);
        const dir = Number(pct) >= 0 ? "increased" : "decreased";
        bullets.push(
          `From ${first.label} to ${last.label}, ${primaryNum.replace(/_/g, " ")} ${dir} by ${Math.abs(Number(pct))}% (${fmt(first.val)} → ${fmt(last.val)}).`
        );
      }
    }

    return {
      headline: top && primaryLabel ? `${top.label} leads ${title}` : `${title} Summary`,
      summary: bullets[0] ?? `Analyzed ${rows.length} rows in ${result.executionMs} ms.`,
      bullets,
      anomalies,
      followUpQuestions: [
        primaryLabel ? `Show monthly trend for ${primaryNum.replace(/_/g, " ")}` : `Break down ${primaryNum.replace(/_/g, " ")} by category`,
        `Top 5 ${primaryLabel ? primaryLabel.replace(/_/g, " ") : "items"} by ${primaryNum.replace(/_/g, " ")} as horizontal bar`,
        `Show ${title} as a data table`,
      ],
      engine: "Built-in Local AI",
    };
  }

  return {
    headline: `${title} (${rows.length} records)`,
    summary: `Returned ${rows.length} rows across ${cols.length} columns in ${result.executionMs} ms.`,
    bullets: [`Columns returned: ${cols.join(", ")}.`],
    anomalies: [],
    followUpQuestions: ["Count distinct records by category", "Show summary KPIs"],
    engine: "Built-in Local AI",
  };
}

export function localSqlCopilot(params: {
  prompt: string;
  dataset: Dataset;
  errorToFix?: string;
  currentSql?: string;
}): SqlCopilotResponse {
  const { prompt, dataset, errorToFix, currentSql } = params;

  if (errorToFix && currentSql) {
    // Attempt simple deterministic repair (quote table name, enforce single SELECT)
    const repaired = currentSql.trim().replace(/;+\s*$/, "");
    const check = validateReadOnlySql(repaired);
    if (check.valid && !errorToFix.toLowerCase().includes("syntax")) {
      return {
        sql: `${repaired}\nLIMIT 100;`,
        explanation: `Adjusted query structure and added a safe row limit to address: ${errorToFix}`,
        engine: "Built-in Local AI",
      };
    }
  }

  const parsed = localAskToChart(prompt || `Show top rows from ${dataset.name}`, dataset);
  const compiled = compileVisualQuery(
    parsed.query,
    dataset.tableName,
    dataset.columns,
    dataset.dialect,
    dataset.schemaName
  );

  return {
    sql: `${compiled.previewSql};`,
    explanation: parsed.explanation,
    engine: "Built-in Local AI",
  };
}
