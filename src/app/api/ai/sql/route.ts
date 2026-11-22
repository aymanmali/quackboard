import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveAiModel } from "@/lib/ai/provider";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { localSqlCopilot } from "@/lib/ai/local-fallback";
import { AiClientConfig } from "@/lib/ai/types";
import { Dataset } from "@/lib/query/types";
import { validateReadOnlySql } from "@/lib/query/validator";

const SqlRequestSchema = z.object({
  prompt: z.string().max(800).default(""),
  errorToFix: z.string().max(600).optional(),
  currentSql: z.string().max(4000).optional(),
  dataset: z.object({
    id: z.string(),
    name: z.string(),
    tableName: z.string(),
    schemaName: z.string().optional(),
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

const LlmSqlSchema = z.object({
  sql: z.string(),
  explanation: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = SqlRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid SQL Copilot payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const dataset = parsed.data.dataset as Dataset;
    const resolved = resolveAiModel(parsed.data.aiConfig as AiClientConfig | undefined);

    if (!resolved) {
      return NextResponse.json(
        localSqlCopilot({
          prompt: parsed.data.prompt,
          dataset,
          errorToFix: parsed.data.errorToFix,
          currentSql: parsed.data.currentSql,
        })
      );
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
      const qualified = dataset.schemaName
        ? `${dataset.schemaName}.${dataset.tableName}`
        : dataset.tableName;
      const schemaSummary = dataset.columns
        .map((c) => `- ${c.name} (${c.type})`)
        .join("\n");

      const promptBody = parsed.data.errorToFix
        ? `Fix this broken ${dataset.dialect} SQL query.\nBroken SQL:\n${parsed.data.currentSql ?? ""}\nError message:\n${parsed.data.errorToFix}`
        : `Write a single read-only ${dataset.dialect} SELECT query for: "${parsed.data.prompt}"`;

      const { output } = await generateText({
        model: resolved.model,
        output: Output.object({ schema: LlmSqlSchema }),
        system:
          "You are QuackBoard SQL Copilot. Return ONLY a single read-only SELECT or WITH query valid for the specified SQL dialect, using exact table and column names, with a reasonable LIMIT (<= 500).",
        prompt: `Table: ${qualified} (dialect: ${dataset.dialect})\nColumns:\n${schemaSummary}\n\n${promptBody}`,
      });

      const check = validateReadOnlySql(output.sql);
      if (!check.valid) {
        const fallback = localSqlCopilot({
          prompt: parsed.data.prompt,
          dataset,
          errorToFix: parsed.data.errorToFix,
          currentSql: parsed.data.currentSql,
        });
        return NextResponse.json({
          ...fallback,
          engine: "Built-in Local AI (Fallback)",
        });
      }

      return NextResponse.json({
        sql: output.sql,
        explanation: output.explanation,
        engine: resolved.engineLabel,
      });
    } catch {
      const fallback = localSqlCopilot({
        prompt: parsed.data.prompt,
        dataset,
        errorToFix: parsed.data.errorToFix,
        currentSql: parsed.data.currentSql,
      });
      return NextResponse.json({
        ...fallback,
        engine: "Built-in Local AI (Fallback)",
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SQL Copilot failed" },
      { status: 500 }
    );
  }
}
