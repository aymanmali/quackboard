import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveAiModel } from "@/lib/ai/provider";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { localAskToChart } from "@/lib/ai/local-fallback";
import { sanitizeVisualQuery } from "@/lib/ai/sanitize";
import { AiClientConfig } from "@/lib/ai/types";
import { Dataset, VisualQuery } from "@/lib/query/types";

const AskChartRequestSchema = z.object({
  prompt: z.string().min(1).max(600),
  dataset: z.object({
    id: z.string(),
    name: z.string(),
    tableName: z.string(),
    dialect: z.enum(["duckdb", "postgres", "mysql"]),
    sourceKind: z.enum(["local_file", "postgres", "mysql"]),
    rowCount: z.number(),
    columns: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["string", "number", "date", "boolean"]),
        role: z.enum(["dimension", "measure"]),
        rawType: z.string().optional(),
      })
    ),
  }),
  aiConfig: z
    .object({
      provider: z.enum(["auto", "google", "openai", "anthropic", "local"]),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const LlmChartSchema = z.object({
  title: z.string(),
  explanation: z.string(),
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
  limit: z.number().int().min(1).max(5000).optional(),
  numberFormat: z.enum(["auto", "currency", "percent", "compact", "decimal"]).optional(),
  showDataLabels: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = AskChartRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const dataset = parsed.data.dataset as Dataset;
    const aiConfig = parsed.data.aiConfig as AiClientConfig | undefined;
    const resolved = resolveAiModel(aiConfig);

    if (!resolved) {
      return NextResponse.json(localAskToChart(parsed.data.prompt, dataset));
    }

    if (resolved.usingServerKey) {
      const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
      const rl = checkAiRateLimit(`ai:${ip}`);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: `AI rate limit exceeded. Try again in ${rl.retryAfterSec}s or enter your own API key in AI Settings.` },
          { status: 429 }
        );
      }
    }

    try {
      const schemaSummary = dataset.columns
        .map((c) => `- ${c.name} (${c.type}, role=${c.role})`)
        .join("\n");

      const { output } = await generateText({
        model: resolved.model,
        output: Output.object({ schema: LlmChartSchema }),
        system:
          "You are QuackBoard AI, an expert BI analyst. Convert the user's request into a valid VisualQuery using ONLY exact column names from the dataset schema. For date dimensions, pick an appropriate dateGranularity. When sorting by a measure, use alias '<aggregation>_<column>' (e.g., sum_sales). Keep titles concise.",
        prompt: `Dataset: "${dataset.name}" (${dataset.rowCount} rows, dialect: ${dataset.dialect})\nColumns:\n${schemaSummary}\n\nUser request: "${parsed.data.prompt}"`,
      });

      const rawQuery: VisualQuery = {
        datasetId: dataset.id,
        dimensions: output.dimensions,
        measures: output.measures,
        colorBy: output.colorByColumn ? { column: output.colorByColumn } : null,
        filters: [],
        sort: output.sortField
          ? [{ field: output.sortField, direction: output.sortDirection ?? "desc" }]
          : undefined,
        limit: output.limit ?? 500,
      };

      const cleanQuery = sanitizeVisualQuery(rawQuery, dataset.id, dataset.columns);

      return NextResponse.json({
        title: output.title,
        explanation: output.explanation,
        chartType: output.chartType,
        query: cleanQuery,
        formatting: {
          palette: "tableau",
          numberFormat: output.numberFormat ?? "auto",
          showDataLabels: output.showDataLabels ?? false,
          showLegend: Boolean(cleanQuery.colorBy) || cleanQuery.measures.length > 1 || output.chartType === "pie",
          legendPosition: "bottom",
          smoothLine: true,
        },
        engine: resolved.engineLabel,
      });
    } catch {
      const fallback = localAskToChart(parsed.data.prompt, dataset);
      return NextResponse.json({
        ...fallback,
        engine: "Built-in Local AI (Fallback)",
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate chart" },
      { status: 500 }
    );
  }
}
