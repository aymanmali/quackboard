import { tool } from "ai";
import { z } from "zod";

export const InspectSchemaInput = z.object({
  datasetId: z
    .string()
    .optional()
    .describe("Optional dataset ID to inspect. Omit to inspect all available datasets."),
});

export const ProfileColumnInput = z.object({
  datasetId: z.string().describe("Dataset ID containing the column"),
  column: z.string().describe("Exact column name to profile"),
  topN: z.number().int().min(1).max(30).optional().describe("Maximum distinct top values (default 15)"),
});

export const RunSqlQueryInput = z.object({
  datasetId: z.string().describe("Target dataset ID"),
  sql: z.string().describe("Read-only SELECT or WITH SQL query valid for the dataset dialect"),
  purpose: z.string().describe("Short description of what this query tests or measures"),
});

export const AnalyzeVarianceInput = z.object({
  datasetId: z.string().describe("Target dataset ID"),
  dimension: z.string().describe("Exact categorical or date dimension column name to group by"),
  measure: z.string().describe("Primary numeric measure column name (e.g., sales)"),
  secondaryMeasure: z
    .string()
    .optional()
    .describe("Optional secondary numeric measure column (e.g., profit) to compute margin/ratio"),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const CreateChartInput = z.object({
  datasetId: z.string().describe("Target dataset ID"),
  title: z.string().describe("Concise chart title"),
  description: z.string().optional().describe("One-line insight or subtitle"),
  chartType: z.enum([
    "auto",
    "bar",
    "stacked_bar",
    "horizontal_bar",
    "line",
    "area",
    "pie",
    "scatter",
    "kpi",
    "table",
  ]),
  dimensions: z.array(
    z.object({
      column: z.string(),
      dateGranularity: z.enum(["raw", "day", "week", "month", "quarter", "year"]).optional(),
    })
  ),
  measures: z.array(
    z.object({
      column: z.string(),
      aggregation: z.enum(["sum", "avg", "count", "count_distinct", "min", "max"]),
    })
  ),
  colorByColumn: z.string().nullable().optional(),
  sortField: z.string().nullable().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  numberFormat: z.enum(["auto", "currency", "percent", "compact", "decimal"]).optional(),
});

export const CreateDashboardInput = z.object({
  name: z.string().describe("Dashboard title"),
  description: z.string().describe("Summary of what this diagnostic dashboard proves"),
  chartIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Exact chartId values returned by previous create_chart tool calls"),
  globalFilterColumns: z
    .array(z.string())
    .max(4)
    .optional()
    .describe("Optional categorical column names for dashboard global filter dropdowns"),
});

/**
 * Client-executed AI SDK v7 tool declarations (omits `execute` so tool calls route
 * back to the browser runtime over DuckDB-Wasm / IndexedDB / live SQL connectors).
 */
export const AGENT_TOOLS = {
  inspect_schema: tool({
    description:
      "Inspect available datasets, table names, SQL dialects, row counts, and column types/roles.",
    inputSchema: InspectSchemaInput,
  }),
  profile_column: tool({
    description:
      "Profile a column in a dataset to see exact distinct values, row frequencies, and null counts before filtering or grouping.",
    inputSchema: ProfileColumnInput,
  }),
  run_sql_query: tool({
    description:
      "Execute a read-only SELECT/WITH SQL query against a dataset. Returns up to 50 rows or the exact SQL error message so you can self-correct.",
    inputSchema: RunSqlQueryInput,
  }),
  analyze_variance: tool({
    description:
      "Compute group-by performance, percentage share, and optional profit/ratio margin across a dimension and up to two measures.",
    inputSchema: AnalyzeVarianceInput,
  }),
  create_chart: tool({
    description:
      "Create and verify a live interactive chart backed by real query execution. Returns a chartId you can include in create_dashboard.",
    inputSchema: CreateChartInput,
  }),
  create_dashboard: tool({
    description:
      "Assemble previously created charts into an interactive cross-filtered QuackBoard dashboard.",
    inputSchema: CreateDashboardInput,
  }),
};
