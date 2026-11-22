"use client";

import { Dataset, QueryResult } from "../query/types";
import {
  AiClientConfig,
  AskChartResponse,
  AutoDashboardResponse,
  InsightsResponse,
  SqlCopilotResponse,
} from "./types";

const STORAGE_KEY = "quackboard-ai-config-v1";

export function loadAiConfig(): AiClientConfig {
  if (typeof window === "undefined") {
    return { provider: "auto" };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { provider: "auto" };
    const parsed = JSON.parse(raw) as AiClientConfig;
    return {
      provider: parsed.provider ?? "auto",
      apiKey: parsed.apiKey ?? "",
      model: parsed.model ?? "",
    };
  } catch {
    return { provider: "auto" };
  }
}

export function saveAiConfig(config: AiClientConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event("quackboard-ai-config-changed"));
}

export interface ServerAiStatusResponse {
  google: boolean;
  openai: boolean;
  anthropic: boolean;
  anyServerProvider: boolean;
  localFallbackReady: boolean;
}

export async function fetchAiStatus(): Promise<ServerAiStatusResponse> {
  const res = await fetch("/api/ai/status");
  if (!res.ok) {
    return {
      google: false,
      openai: false,
      anthropic: false,
      anyServerProvider: false,
      localFallbackReady: true,
    };
  }
  return res.json();
}

async function postAi<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
  const config = loadAiConfig();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, aiConfig: config }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "AI request failed");
  }
  return data as T;
}

export function callAskChart(prompt: string, dataset: Dataset): Promise<AskChartResponse> {
  return postAi<AskChartResponse>("/api/ai/ask-chart", { prompt, dataset });
}

export function callAutoDashboard(
  dataset: Dataset,
  goal?: string
): Promise<AutoDashboardResponse> {
  return postAi<AutoDashboardResponse>("/api/ai/auto-dashboard", { dataset, goal });
}

export function callExplainInsights(params: {
  title: string;
  result: QueryResult;
  context?: string;
}): Promise<InsightsResponse> {
  return postAi<InsightsResponse>("/api/ai/insights", {
    title: params.title,
    context: params.context,
    result: {
      ...params.result,
      rows: params.result.rows.slice(0, 50),
    },
  });
}

export function callSqlCopilot(params: {
  prompt: string;
  dataset: Dataset;
  errorToFix?: string;
  currentSql?: string;
}): Promise<SqlCopilotResponse> {
  return postAi<SqlCopilotResponse>("/api/ai/sql", params);
}
