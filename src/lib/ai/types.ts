import { ChartFormatting, ChartType, VisualQuery } from "../query/types";

export type AiProviderId = "auto" | "google" | "openai" | "anthropic" | "local";

export interface AiClientConfig {
  provider: AiProviderId;
  apiKey?: string;
  model?: string;
}

export interface AskChartResponse {
  title: string;
  explanation: string;
  chartType: ChartType;
  query: VisualQuery;
  formatting: Partial<ChartFormatting>;
  engine: string;
}

export interface AutoDashboardChartSpec {
  title: string;
  description: string;
  chartType: ChartType;
  query: VisualQuery;
  formatting: Partial<ChartFormatting>;
}

export interface AutoDashboardResponse {
  name: string;
  description: string;
  charts: AutoDashboardChartSpec[];
  globalFilterColumns: string[];
  engine: string;
}

export interface InsightsResponse {
  headline: string;
  summary: string;
  bullets: string[];
  anomalies: string[];
  followUpQuestions: string[];
  engine: string;
}

export interface SqlCopilotResponse {
  sql: string;
  explanation: string;
  engine: string;
}
