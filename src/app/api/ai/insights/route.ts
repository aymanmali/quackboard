import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveAiModel } from "@/lib/ai/provider";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { localExplainInsights } from "@/lib/ai/local-fallback";
import { AiClientConfig } from "@/lib/ai/types";
import { QueryResult } from "@/lib/query/types";

const InsightsRequestSchema = z.object({
  title: z.string().min(1).max(200),
  context: z.string().max(400).optional(),
  result: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.record(z.unknown())),
    sql: z.string().default(""),
    executionMs: z.number().default(0),
    rowCount: z.number().default(0),
    truncated: z.boolean().default(false),
  }),
  aiConfig: z
    .object({
      provider: z.enum(["auto", "google", "openai", "anthropic", "local"]),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const LlmInsightsSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  bullets: z.array(z.string()).min(2).max(5),
  anomalies: z.array(z.string()).max(3),
  followUpQuestions: z.array(z.string()).min(2).max(4),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = InsightsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid insights payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const cappedResult: QueryResult = {
      ...parsed.data.result,
      rows: parsed.data.result.rows.slice(0, 50),
    };

    const resolved = resolveAiModel(parsed.data.aiConfig as AiClientConfig | undefined);
    if (!resolved) {
      return NextResponse.json(localExplainInsights(parsed.data.title, cappedResult));
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
      const { output } = await generateText({
        model: resolved.model,
        output: Output.object({ schema: LlmInsightsSchema }),
        system:
          "You are QuackBoard AI, an analytical executive advisor. Cite concrete numbers and entities from the provided query result rows. Keep bullets sharp and propose actionable natural-language follow-up questions that work in a chart builder.",
        prompt: `Chart/Dashboard: "${parsed.data.title}"\n${
          parsed.data.context ? `Context: ${parsed.data.context}\n` : ""
        }Columns: ${cappedResult.columns.join(", ")}\nSample Rows (${cappedResult.rows.length}):\n${JSON.stringify(
          cappedResult.rows
        )}`,
      });

      return NextResponse.json({
        ...output,
        engine: resolved.engineLabel,
      });
    } catch {
      const fallback = localExplainInsights(parsed.data.title, cappedResult);
      return NextResponse.json({
        ...fallback,
        engine: "Built-in Local AI (Fallback)",
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate insights" },
      { status: 500 }
    );
  }
}
