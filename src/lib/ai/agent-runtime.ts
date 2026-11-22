import { Dashboard, Dataset, QueryResult, SavedChart } from "../query/types";
import { loadAiConfig } from "./ai-client";
import { AgentExecutorDeps, executeAgentToolWithDeps } from "./agent-executor";
import {
  AgentRunResult,
  AgentStepResponse,
  AgentStepTrace,
  AgentToolCall,
  AgentToolResult,
  WRITE_TOOLS,
} from "./agent-types";

export type StepPlannerFn = (params: {
  goal: string;
  datasets: Dataset[];
  history: AgentStepTrace[];
  signal?: AbortSignal;
}) => Promise<AgentStepResponse>;

export async function remoteAgentStepPlanner(params: {
  goal: string;
  datasets: Dataset[];
  history: AgentStepTrace[];
  signal?: AbortSignal;
}): Promise<AgentStepResponse> {
  const aiConfig = loadAiConfig();
  const res = await fetch("/api/ai/agent/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({
      goal: params.goal,
      datasets: params.datasets,
      history: params.history,
      aiConfig,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Agent reasoning step failed");
  }
  return data as AgentStepResponse;
}

export interface RunAgentLoopOptions {
  goal: string;
  datasets: Dataset[];
  maxSteps?: number;
  requireWriteApproval: boolean;
  stepPlanner: StepPlannerFn;
  executorDeps: AgentExecutorDeps;
  onStepUpdate?: (steps: AgentStepTrace[]) => void;
  onChartCreated?: (entry: { chart: SavedChart; result: QueryResult | null }) => void;
  onDashboardCreated?: (dashboard: Dashboard) => void;
  onApprovalRequest?: (call: AgentToolCall) => Promise<boolean>;
  signal?: AbortSignal;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 8;
  const steps: AgentStepTrace[] = [];
  let createdDashboard: Dashboard | null = null;
  let lastEngine = "Built-in ReAct Agent";

  const wrappedDeps: AgentExecutorDeps = {
    ...options.executorDeps,
    onDashboardCreated: (dash) => {
      createdDashboard = dash;
      options.executorDeps.onDashboardCreated?.(dash);
      options.onDashboardCreated?.(dash);
    },
  };

  try {
    for (let i = 0; i < maxSteps; i++) {
      if (options.signal?.aborted) {
        return {
          goal: options.goal,
          steps,
          createdCharts: Array.from(wrappedDeps.createdChartsMap.values()),
          createdDashboard,
          engine: lastEngine,
          status: "stopped",
        };
      }

      const plan = await options.stepPlanner({
        goal: options.goal,
        datasets: options.datasets,
        history: steps,
        signal: options.signal,
      });
      lastEngine = plan.engine;

      if (plan.done || plan.toolCalls.length === 0) {
        const finalStep: AgentStepTrace = {
          step: i + 1,
          thought: plan.thought,
          toolCalls: [],
          toolResults: [],
          engine: plan.engine,
        };
        steps.push(finalStep);
        options.onStepUpdate?.([...steps]);

        return {
          goal: options.goal,
          steps,
          createdCharts: Array.from(wrappedDeps.createdChartsMap.values()),
          createdDashboard,
          finalAnswer: plan.finalAnswer,
          engine: plan.engine,
          status: "completed",
        };
      }

      const prevHadError =
        steps.length > 0 &&
        steps[steps.length - 1].toolResults.some((r) => !r.ok && !r.skippedByUser);

      const toolResults: AgentToolResult[] = [];
      for (const tc of plan.toolCalls) {
        if (options.signal?.aborted) break;

        if (
          options.requireWriteApproval &&
          WRITE_TOOLS.has(tc.toolName) &&
          options.onApprovalRequest
        ) {
          const approved = await options.onApprovalRequest(tc);
          if (!approved) {
            toolResults.push({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              ok: false,
              skippedByUser: true,
              error: "Skipped by user in Human-in-the-Loop approval mode",
              executionMs: 0,
            });
            continue;
          }
        }

        const res = await executeAgentToolWithDeps(tc, wrappedDeps);
        toolResults.push(res);

        if (res.ok && tc.toolName === "create_chart" && typeof res.data?.chartId === "string") {
          const entry = wrappedDeps.createdChartsMap.get(String(res.data.chartId));
          if (entry) {
            options.onChartCreated?.(entry);
          }
        }
      }

      const selfRepaired = prevHadError && toolResults.some((r) => r.ok);
      steps.push({
        step: i + 1,
        thought: plan.thought,
        toolCalls: plan.toolCalls,
        toolResults,
        selfRepaired,
        engine: plan.engine,
      });
      options.onStepUpdate?.([...steps]);
    }

    // Reached maxSteps gracefully
    return {
      goal: options.goal,
      steps,
      createdCharts: Array.from(wrappedDeps.createdChartsMap.values()),
      createdDashboard,
      finalAnswer: {
        headline: "Investigation Reached Step Limit",
        summary: `Completed ${steps.length} analytical steps on "${options.datasets[0]?.name ?? "dataset"}".`,
        keyFindings: steps
          .flatMap((s) => s.toolResults.filter((r) => r.ok).map((r) => `Executed ${r.toolName} (${r.executionMs} ms)`))
          .slice(0, 5),
        rootCauses: [],
        recommendations: ["Review the step trace above or ask a more targeted follow-up question."],
        citations: steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
      },
      engine: lastEngine,
      status: "completed",
    };
  } catch (err) {
    if (options.signal?.aborted) {
      return {
        goal: options.goal,
        steps,
        createdCharts: Array.from(wrappedDeps.createdChartsMap.values()),
        createdDashboard,
        engine: lastEngine,
        status: "stopped",
      };
    }
    return {
      goal: options.goal,
      steps,
      createdCharts: Array.from(wrappedDeps.createdChartsMap.values()),
      createdDashboard,
      engine: lastEngine,
      status: "error",
      error: err instanceof Error ? err.message : "Agent execution error",
    };
  }
}
