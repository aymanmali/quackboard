import { Dashboard, QueryResult, SavedChart } from "../query/types";

export type AgentToolName =
  | "inspect_schema"
  | "profile_column"
  | "run_sql_query"
  | "analyze_variance"
  | "create_chart"
  | "create_dashboard";

export const WRITE_TOOLS = new Set<AgentToolName>(["create_chart", "create_dashboard"]);

export interface AgentToolCall {
  toolCallId: string;
  toolName: AgentToolName;
  input: Record<string, unknown>;
}

export interface AgentToolResult {
  toolCallId: string;
  toolName: AgentToolName;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  executionMs: number;
  skippedByUser?: boolean;
}

export interface AgentStepTrace {
  step: number;
  thought: string;
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  selfRepaired?: boolean;
  engine: string;
}

export interface AgentFinalAnswer {
  headline: string;
  summary: string;
  keyFindings: string[];
  rootCauses: string[];
  recommendations: string[];
  citations: string[];
}

export interface AgentStepResponse {
  done: boolean;
  thought: string;
  toolCalls: AgentToolCall[];
  finalAnswer?: AgentFinalAnswer;
  engine: string;
}

export interface AgentRunResult {
  goal: string;
  steps: AgentStepTrace[];
  createdCharts: Array<{ chart: SavedChart; result: QueryResult | null }>;
  createdDashboard?: Dashboard | null;
  finalAnswer?: AgentFinalAnswer;
  engine: string;
  status: "completed" | "stopped" | "error";
  error?: string;
}
