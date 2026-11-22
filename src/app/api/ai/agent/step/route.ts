import { NextRequest, NextResponse } from "next/server";
import { generateText, ModelMessage, Output } from "ai";
import { z } from "zod";
import { planNextLocalAgentStep } from "@/lib/ai/agent-local-planner";
import { AGENT_TOOLS } from "@/lib/ai/agent-tool-schemas";
import {
  AgentStepTrace,
  AgentToolCall,
  AgentToolName,
} from "@/lib/ai/agent-types";
import { resolveAiModel } from "@/lib/ai/provider";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { AiClientConfig } from "@/lib/ai/types";
import { Dataset } from "@/lib/query/types";

const StepRequestSchema = z.object({
  goal: z.string().min(1).max(1000),
  datasets: z.array(z.any()).min(1),
  history: z.array(z.any()).default([]),
  aiConfig: z
    .object({
      provider: z.enum(["auto", "google", "openai", "anthropic", "local"]),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const FinalAnswerSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  keyFindings: z.array(z.string()).min(1),
  rootCauses: z.array(z.string()),
  recommendations: z.array(z.string()),
  citations: z.array(z.string()),
});

function buildModelMessages(
  goal: string,
  datasets: Dataset[],
  history: AgentStepTrace[]
): ModelMessage[] {
  const schemaOverview = datasets
    .map(
      (ds) =>
        `Dataset "${ds.name}" (id="${ds.id}", table="${ds.tableName}", dialect="${ds.dialect}", rows=${ds.rowCount}):\n` +
        ds.columns.map((c) => `  - ${c.name} (${c.type}, role=${c.role})`).join("\n")
    )
    .join("\n\n");

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Goal: ${goal}\n\nAvailable Datasets:\n${schemaOverview}`,
    },
  ];

  for (const step of history) {
    if (step.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: step.toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        })),
      });
    }

    if (step.toolResults.length > 0) {
      messages.push({
        role: "tool",
        content: step.toolResults.map((tr) => ({
          type: "tool-result" as const,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: {
            type: "text" as const,
            value: JSON.stringify(
              tr.ok
                ? tr.data ?? {}
                : { error: tr.error ?? "Tool failed", skippedByUser: Boolean(tr.skippedByUser) }
            ),
          },
        })),
      });
    }
  }

  return messages;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = StepRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid agent step payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const datasets = parsed.data.datasets as Dataset[];
    const history = parsed.data.history as AgentStepTrace[];
    const resolved = resolveAiModel(parsed.data.aiConfig as AiClientConfig | undefined);

    if (!resolved) {
      return NextResponse.json(
        planNextLocalAgentStep({ goal: parsed.data.goal, datasets, history })
      );
    }

    if (resolved.usingServerKey) {
      const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
      const rl = checkAiRateLimit(`agent:${ip}`, 60, 10 * 60 * 1000);
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: `AI Agent rate limit exceeded. Try again in ${rl.retryAfterSec}s or enter your own API key in AI Settings.`,
          },
          { status: 429 }
        );
      }
    }

    try {
      const messages = buildModelMessages(parsed.data.goal, datasets, history);
      const result = await generateText({
        model: resolved.model,
        system:
          "You are QuackBoard Autonomous Data Analyst. Investigate the user's question systematically using your tools: (1) inspect_schema / profile_column before filtering, (2) run_sql_query & analyze_variance to test hypotheses and uncover drivers, (3) if a SQL query returns an error, inspect the error and immediately rewrite a corrected query, (4) materialize 2-4 verified charts via create_chart and combine them via create_dashboard when building reports/dashboards. When you have all verified facts, stop calling tools and write a concise, numerically grounded executive summary citing only observed tool results.",
        messages,
        tools: AGENT_TOOLS,
      });

      if (result.toolCalls.length > 0) {
        const mappedCalls: AgentToolCall[] = result.toolCalls.map((tc) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName as AgentToolName,
          input: (tc.input ?? {}) as Record<string, unknown>,
        }));

        return NextResponse.json({
          done: false,
          thought:
            result.text?.trim() ||
            `Executing ${mappedCalls.map((c) => c.toolName).join(", ")}...`,
          toolCalls: mappedCalls,
          engine: resolved.engineLabel,
        });
      }

      try {
        const structured = await generateText({
          model: resolved.model,
          output: Output.object({ schema: FinalAnswerSchema }),
          system:
            "Structure the analyst's final findings into the required JSON report schema. Cite only observed tool values.",
          prompt: `Goal: ${parsed.data.goal}\nAnalyst conclusion:\n${result.text}`,
        });

        return NextResponse.json({
          done: true,
          thought: "Analysis verified and complete.",
          toolCalls: [],
          finalAnswer: structured.output,
          engine: resolved.engineLabel,
        });
      } catch {
        const rawText = result.text?.trim() || "Analysis complete.";
        return NextResponse.json({
          done: true,
          thought: "Analysis complete.",
          toolCalls: [],
          finalAnswer: {
            headline: "Executive Analysis Report",
            summary: rawText,
            keyFindings: [rawText],
            rootCauses: [],
            recommendations: [],
            citations: history.flatMap((h) => h.toolCalls.map((c) => c.toolName)),
          },
          engine: resolved.engineLabel,
        });
      }
    } catch {
      const fallback = planNextLocalAgentStep({
        goal: parsed.data.goal,
        datasets,
        history,
      });
      return NextResponse.json({
        ...fallback,
        engine: "Built-in ReAct Agent (Fallback)",
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent step failed" },
      { status: 500 }
    );
  }
}
