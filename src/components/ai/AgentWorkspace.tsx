"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import { createBrowserExecutorDeps } from "@/lib/ai/agent-browser-deps";
import { remoteAgentStepPlanner, runAgentLoop } from "@/lib/ai/agent-runtime";
import {
  AgentFinalAnswer,
  AgentStepTrace,
  AgentToolCall,
} from "@/lib/ai/agent-types";
import { Dashboard, Dataset, QueryResult, SavedChart } from "@/lib/query/types";
import { listDatasets } from "@/lib/storage/indexeddb-store";
import { ChartView } from "../charts/ChartView";

const STARTER_PROMPTS = [
  "Investigate why profit differs across categories & build a diagnostic dashboard",
  "Analyze regional sales performance, margin leaders & concentration risks",
  "Compare monthly revenue & profit trends and create an executive report",
];

interface PendingApproval {
  call: AgentToolCall;
  resolve: (approved: boolean) => void;
}

export function AgentWorkspace() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [requireWriteApproval, setRequireWriteApproval] = useState(false);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStepTrace[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [createdCharts, setCreatedCharts] = useState<
    Array<{ chart: SavedChart; result: QueryResult | null }>
  >([]);
  const [createdDashboard, setCreatedDashboard] = useState<Dashboard | null>(null);
  const [finalAnswer, setFinalAnswer] = useState<AgentFinalAnswer | null>(null);
  const [engineLabel, setEngineLabel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listDatasets().then((ds) => {
      setDatasets(ds);
      if (ds[0]) setSelectedDatasetId(ds[0].id);
    });
  }, []);

  const orderedDatasets = React.useMemo(() => {
    if (!selectedDatasetId) return datasets;
    const selected = datasets.find((d) => d.id === selectedDatasetId);
    const rest = datasets.filter((d) => d.id !== selectedDatasetId);
    return selected ? [selected, ...rest] : datasets;
  }, [datasets, selectedDatasetId]);

  const handleStop = () => {
    abortRef.current?.abort();
    if (pendingApproval) {
      pendingApproval.resolve(false);
      setPendingApproval(null);
    }
  };

  const runInvestigation = async (customGoal?: string) => {
    const activeGoal = (customGoal ?? goal).trim();
    if (!activeGoal || orderedDatasets.length === 0 || running) return;
    if (customGoal) setGoal(customGoal);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setSteps([]);
    setExpandedSteps({});
    setCreatedCharts([]);
    setCreatedDashboard(null);
    setFinalAnswer(null);
    setError(null);
    setPendingApproval(null);

    const createdChartsMap = new Map<
      string,
      { chart: SavedChart; result: QueryResult | null }
    >();

    const executorDeps = createBrowserExecutorDeps({
      datasets: orderedDatasets,
      createdChartsMap,
      onDashboardCreated: (dash) => setCreatedDashboard(dash),
    });

    try {
      const outcome = await runAgentLoop({
        goal: activeGoal,
        datasets: orderedDatasets,
        maxSteps: 8,
        requireWriteApproval,
        stepPlanner: remoteAgentStepPlanner,
        executorDeps,
        signal: controller.signal,
        onStepUpdate: (updatedSteps) => {
          setSteps(updatedSteps);
          const latest = updatedSteps[updatedSteps.length - 1];
          if (latest) {
            setExpandedSteps((prev) => ({ ...prev, [latest.step]: true }));
          }
        },
        onChartCreated: (entry) => {
          setCreatedCharts((prev) => [...prev, entry]);
        },
        onDashboardCreated: (dash) => {
          setCreatedDashboard(dash);
        },
        onApprovalRequest: (call) =>
          new Promise<boolean>((resolve) => {
            setPendingApproval({ call, resolve });
          }),
      });

      setEngineLabel(outcome.engine);
      if (outcome.finalAnswer) setFinalAnswer(outcome.finalAnswer);
      if (outcome.status === "error" && outcome.error) {
        setError(outcome.error);
      }
    } finally {
      setRunning(false);
      setPendingApproval(null);
    }
  };

  const primaryDataset = orderedDatasets[0];

  return (
    <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header & Controls */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Autonomous AI Data Analyst
                </h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  ReAct Agent v0.3
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Multi-step reasoning loop that profiles columns, queries DuckDB-Wasm / SQL,
                self-heals errors, and builds verified dashboards.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              disabled={running}
              aria-label="Target Dataset"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.dialect})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={running}
              onClick={() => setRequireWriteApproval((v) => !v)}
              title="Human-in-the-Loop: require explicit approval before saving charts or dashboards"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                requireWriteApproval
                  ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-300"
                  : "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
              }`}
            >
              {requireWriteApproval ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : (
                <Shield className="w-3.5 h-3.5" />
              )}
              <span>
                {requireWriteApproval
                  ? "HITL: Require Approval for Writes"
                  : "HITL: Auto-Approve Writes"}
              </span>
            </button>
          </div>
        </div>

        {/* Prompt Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runInvestigation();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={running}
            placeholder="Ask a multi-step analytical question... e.g., Investigate profit drivers across categories & build a diagnostic dashboard"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop Agent
            </button>
          ) : (
            <button
              type="submit"
              disabled={!goal.trim() || orderedDatasets.length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Run Investigation
            </button>
          )}
        </form>

        {/* Starter Investigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={running || orderedDatasets.length === 0}
              onClick={() => runInvestigation(prompt)}
              className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-all cursor-pointer disabled:opacity-50 group"
            >
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                <span className="line-clamp-2">{prompt}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-violet-600 shrink-0" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* HITL Approval Prompt */}
      {pendingApproval && (
        <section className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-5 shadow-md space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <h3 className="font-bold text-sm text-amber-950 dark:text-amber-100">
                  Human-in-the-Loop Approval Required:{" "}
                  <span className="font-mono">{pendingApproval.call.toolName}</span>
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Review this write action before the agent modifies your saved charts or
                  dashboards.
                </p>
              </div>
            </div>
          </div>

          <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto max-h-40">
            {JSON.stringify(pendingApproval.call.input, null, 2)}
          </pre>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                pendingApproval.resolve(false);
                setPendingApproval(null);
              }}
              className="px-3.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer"
            >
              Skip Action
            </button>
            <button
              type="button"
              onClick={() => {
                pendingApproval.resolve(true);
                setPendingApproval(null);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve &amp; Execute
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Split: Agent Trace + Final Report / Inline Visuals */}
      {(steps.length > 0 || running) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Live Agent Execution Trace */}
          <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                  Live Agent Trace ({steps.length} steps)
                </h2>
              </div>
              {running && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Reasoning...
                </span>
              )}
            </div>

            <div className="space-y-2.5">
              {steps.map((step) => {
                const isOpen = Boolean(expandedSteps[step.step]);
                const hasError = step.toolResults.some((r) => !r.ok && !r.skippedByUser);
                return (
                  <div
                    key={step.step}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSteps((prev) => ({
                          ...prev,
                          [step.step]: !prev[step.step],
                        }))
                      }
                      className="w-full px-3.5 py-2.5 flex items-start justify-between gap-2 text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/60 cursor-pointer"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100">
                            Step {step.step}
                          </span>
                          {step.selfRepaired && (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300">
                              Self-Healed
                            </span>
                          )}
                          {step.toolCalls.map((tc) => (
                            <span
                              key={tc.toolCallId}
                              className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                            >
                              {tc.toolName}
                            </span>
                          ))}
                          {hasError && (
                            <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          {step.thought}
                        </p>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      )}
                    </button>

                    {isOpen && step.toolResults.length > 0 && (
                      <div className="px-3.5 pb-3 pt-1 space-y-2 border-t border-slate-200 dark:border-slate-800">
                        {step.toolResults.map((tr) => {
                          const matchingCall = step.toolCalls.find(
                            (c) => c.toolCallId === tr.toolCallId
                          );
                          return (
                            <div
                              key={tr.toolCallId}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-[11px] space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                                  {tr.toolName}
                                </span>
                                <span
                                  className={`font-medium px-1.5 py-0.5 rounded ${
                                    tr.ok
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                      : tr.skippedByUser
                                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                  }`}
                                >
                                  {tr.ok
                                    ? `OK • ${tr.executionMs} ms`
                                    : tr.skippedByUser
                                    ? "Skipped (HITL)"
                                    : "Error"}
                                </span>
                              </div>

                              {typeof matchingCall?.input?.sql === "string" && (
                                <pre className="p-2 rounded bg-slate-950 text-slate-100 font-mono text-[10px] overflow-x-auto">
                                  {matchingCall.input.sql}
                                </pre>
                              )}

                              {tr.error && (
                                <div className="text-rose-600 dark:text-rose-400 font-medium">
                                  {tr.error}
                                </div>
                              )}

                              {tr.ok && tr.data && (
                                <pre className="p-2 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-mono text-[10px] overflow-x-auto max-h-36">
                                  {JSON.stringify(tr.data, null, 2)}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* RIGHT: Grounded Executive Report + Live Materialized Visuals */}
          <section className="lg:col-span-7 space-y-5">
            {finalAnswer && (
              <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Grounded Executive Report • {engineLabel || "ReAct Agent"}</span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {finalAnswer.headline}
                    </h2>
                  </div>

                  {createdDashboard && (
                    <Link
                      href={`/dashboards/${createdDashboard.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shrink-0"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      Open Generated Dashboard
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {finalAnswer.summary}
                </p>

                {finalAnswer.keyFindings.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Key Findings
                    </h3>
                    <ul className="space-y-1 text-xs sm:text-sm text-slate-700 dark:text-slate-200 list-disc pl-5">
                      {finalAnswer.keyFindings.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {finalAnswer.rootCauses.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Root Causes &amp; Drivers
                    </h3>
                    <ul className="space-y-1 text-xs sm:text-sm text-slate-700 dark:text-slate-200 list-disc pl-5">
                      {finalAnswer.rootCauses.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {finalAnswer.recommendations.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Recommended Actions
                    </h3>
                    <ul className="space-y-1 text-xs sm:text-sm text-slate-700 dark:text-slate-200 list-disc pl-5">
                      {finalAnswer.recommendations.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {finalAnswer.citations.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-400">
                      Verified Tool Citations:
                    </span>
                    {finalAnswer.citations.map((cite, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      >
                        {cite}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline Rendered Charts Materialized by the Agent */}
            {createdCharts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Materialized Visuals ({createdCharts.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {createdCharts.map(({ chart, result }) => {
                    const ds =
                      datasets.find((d) => d.id === chart.datasetId) ?? primaryDataset;
                    return (
                      <div
                        key={chart.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                              {chart.name}
                            </h4>
                            {chart.description && (
                              <p className="text-[11px] text-slate-400 truncate">
                                {chart.description}
                              </p>
                            )}
                          </div>
                          <Link
                            href={`/explore?chartId=${chart.id}`}
                            className="text-[11px] font-semibold text-blue-600 hover:underline shrink-0"
                          >
                            Edit
                          </Link>
                        </div>
                        <div className="relative w-full h-[280px]">
                          <div className="absolute inset-0">
                            <ChartView
                              title={chart.name}
                              chartType={chart.chartType}
                              query={chart.query}
                              result={result}
                              columns={ds?.columns ?? []}
                              formatting={chart.formatting}
                              compactTable
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
