import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveAiModel } from "@/lib/ai/provider";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { localGenerateDashboard } from "@/lib/ai/local-fallback";
import { sanitizeVisualQuery } from "@/lib/ai/sanitize";
import { AiClientConfig, AutoDashboardChartSpec } from "@/lib/ai/types";
import { Dataset, VisualQuery } from "@/lib/query/types";

const AutoDashRequestSchema = z.object({
  goal: z.string().max(400).optional(),
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

const LlmAutoDashSchema = z.object({
  name: z.string(),
  description: z.string(),
  globalFilterColumns: z.array(z.string()).max(4),
  charts: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        chartType: z.enum([
          "bar",
          "stacked_bar",
          "horizontal_bar",
          "line",
          "area",
          "pie",
          "scatter",
          "kpi",
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
        numberFormat: z.enum(["auto", "currency", "percent", "compact", "decimal"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .min(3)
    .max(7),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = AutoDashRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const dataset = parsed.data.dataset as Dataset;
    const goal = parsed.data.goal;
    const resolved = resolveAiModel(parsed.data.aiConfig as AiClientConfig | undefined);

    if (!resolved) {
      return NextResponse.json(localGenerateDashboard(dataset, goal));
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
        output: Output.object({ schema: LlmAutoDashSchema }),
        system:
          "You are QuackBoard AI, an executive BI architect. Design a crisp 5–7 tile dashboard (2–3 KPI cards first, then time-series, breakdown bars, and a donut/ranking chart) using ONLY exact column names from the schema.",
        prompt: `Dataset: "${dataset.name}" (${dataset.rowCount} rows)\nColumns:\n${schemaSummary}\n${
          goal ? `Focus goal: "${goal}"` : "Goal: Executive overview"
        }`,
      });

      const validColNames = new Set(dataset.columns.map((c) => c.name));
      const charts: AutoDashboardChartSpec[] = output.charts.map((c) => {
        const rawQuery: VisualQuery = {
          datasetId: dataset.id,
          dimensions: c.dimensions,
          measures: c.measures,
          colorBy: c.colorByColumn ? { column: c.colorByColumn } : null,
          filters: [],
          limit: c.limit ?? 100,
        };
        const cleanQuery = sanitizeVisualQuery(rawQuery, dataset.id, dataset.columns);
        return {
          title: c.title,
          description: c.description,
          chartType: c.chartType,
          query: cleanQuery,
          formatting: {
            palette: c.chartType === "kpi" ? "tableau" : "ocean",
            numberFormat: c.numberFormat ?? "auto",
            showLegend: c.chartType !== "kpi" && (Boolean(cleanQuery.colorBy) || cleanQuery.measures.length > 1 || c.chartType === "pie"),
            showDataLabels: c.chartType === "pie" || c.chartType === "horizontal_bar",
            legendPosition: "bottom",
            smoothLine: true,
          },
        };
      });

      return NextResponse.json({
        name: output.name,
        description: output.description,
        charts,
        globalFilterColumns: output.globalFilterColumns.filter((col) => validColNames.has(col)).slice(0, 3),
        engine: resolved.engineLabel,
      });
    } catch {
      const fallback = localGenerateDashboard(dataset, goal);
      return NextResponse.json({
        ...fallback,
        engine: "Built-in Local AI (Fallback)",
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to auto-generate dashboard" },
      { status: 500 }
    );
  }
}
