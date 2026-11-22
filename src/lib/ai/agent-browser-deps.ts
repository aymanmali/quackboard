"use client";

import { executeAdHocSql, executeVisualQuery } from "../engines/query-runner";
import { Dashboard, Dataset, QueryResult, SavedChart } from "../query/types";
import { saveChart, saveDashboard } from "../storage/indexeddb-store";
import { AgentExecutorDeps } from "./agent-executor";

export function createBrowserExecutorDeps(params: {
  datasets: Dataset[];
  createdChartsMap: Map<string, { chart: SavedChart; result: QueryResult | null }>;
  onDashboardCreated?: (dashboard: Dashboard) => void;
}): AgentExecutorDeps {
  return {
    datasets: params.datasets,
    runSql: (dataset, sql) => executeAdHocSql({ dataset, sql }),
    runVisualQuery: (dataset, query) => executeVisualQuery(dataset, query),
    saveChartFn: (chart) => saveChart(chart),
    saveDashboardFn: (dashboard) => saveDashboard(dashboard),
    createdChartsMap: params.createdChartsMap,
    onDashboardCreated: params.onDashboardCreated,
  };
}
