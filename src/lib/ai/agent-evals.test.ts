import { describe, expect, it } from "vitest";
import { Dashboard, Dataset, QueryResult, SavedChart, VisualQuery } from "../query/types";
import { AgentExecutorDeps, executeAgentToolWithDeps } from "./agent-executor";
import { planNextLocalAgentStep } from "./agent-local-planner";
import { runAgentLoop } from "./agent-runtime";
import { AgentStepTrace } from "./agent-types";

const evalDataset: Dataset = {
  id: "eval-superstore",
  name: "Global Superstore Sales",
  sourceKind: "local_file",
  dialect: "duckdb",
  tableName: "superstore",
  rowCount: 6,
  columns: [
    { name: "order_id", type: "string", role: "dimension" },
    { name: "order_date", type: "date", role: "dimension" },
    { name: "region", type: "string", role: "dimension" },
    { name: "category", type: "string", role: "dimension" },
    { name: "sub_category", type: "string", role: "dimension" },
    { name: "sales", type: "number", role: "measure" },
    { name: "profit", type: "number", role: "measure" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const syntheticRows = [
  { order_id: "1", order_date: "2025-01-10", region: "North America", category: "Technology", sub_category: "Laptops", sales: 5000, profit: 1400 },
  { order_id: "2", order_date: "2025-02-12", region: "Europe", category: "Technology", sub_category: "Phones", sales: 3200, profit: 900 },
  { order_id: "3", order_date: "2025-03-08", region: "Europe", category: "Furniture", sub_category: "Chairs", sales: 2800, profit: 220 },
  { order_id: "4", order_date: "2025-04-15", region: "Asia Pacific", category: "Furniture", sub_category: "Tables", sales: 2400, profit: -180 },
  { order_id: "5", order_date: "2025-05-20", region: "North America", category: "Office Supplies", sub_category: "Binders", sales: 1600, profit: 640 },
  { order_id: "6", order_date: "2025-06-22", region: "Latin America", category: "Office Supplies", sub_category: "Paper", sales: 1000, profit: 420 },
];

function createEvalDeps(opts?: { failFirstTotalsSql?: boolean }) {
  const savedCharts: SavedChart[] = [];
  const savedDashboards: Dashboard[] = [];
  const createdChartsMap = new Map<string, { chart: SavedChart; result: QueryResult | null }>();
  let injectedSqlFailure = false;

  const deps: AgentExecutorDeps = {
    datasets: [evalDataset],
    createdChartsMap,
    saveChartFn: async (c) => {
      savedCharts.push(c);
    },
    saveDashboardFn: async (d) => {
      savedDashboards.push(d);
    },
    runSql: async (_ds, sql): Promise<QueryResult> => {
      if (opts?.failFirstTotalsSql && !injectedSqlFailure && sql.includes("total_records")) {
        injectedSqlFailure = true;
        throw new Error("Binder Error: Simulated schema mismatch on first attempt");
      }

      if (sql.includes("total_records")) {
        const totalSales = syntheticRows.reduce((a, r) => a + r.sales, 0);
        const totalProfit = syntheticRows.reduce((a, r) => a + r.profit, 0);
        return {
          columns: ["total_records", "total_sales", "total_profit", "margin_pct"],
          rows: [
            {
              total_records: syntheticRows.length,
              total_sales: totalSales,
              total_profit: totalProfit,
              margin_pct: Number(((totalProfit * 100) / totalSales).toFixed(2)),
            },
          ],
          sql,
          executionMs: 2,
          rowCount: 1,
          truncated: false,
        };
      }

      if (sql.includes("AS period")) {
        const rows = syntheticRows.map((r) => ({
          period: r.order_date.slice(0, 7),
          sum_sales: r.sales,
          sum_profit: r.profit,
        }));
        return {
          columns: ["period", "sum_sales", "sum_profit"],
          rows,
          sql,
          executionMs: 3,
          rowCount: rows.length,
          truncated: false,
        };
      }

      if (sql.includes("DISTINCT")) {
        return {
          columns: ["total_rows", "distinct_count", "null_count"],
          rows: [{ total_rows: syntheticRows.length, distinct_count: 3, null_count: 0 }],
          sql,
          executionMs: 1,
          rowCount: 1,
          truncated: false,
        };
      }

      const topMap = new Map<string, number>();
      syntheticRows.forEach((r) => {
        topMap.set(r.category, (topMap.get(r.category) ?? 0) + 1);
      });
      const topRows = Array.from(topMap.entries()).map(([value, row_count]) => ({
        value,
        row_count,
      }));
      return {
        columns: ["value", "row_count"],
        rows: topRows,
        sql,
        executionMs: 1,
        rowCount: topRows.length,
        truncated: false,
      };
    },
    runVisualQuery: async (_ds, query: VisualQuery): Promise<QueryResult> => {
      if (query.dimensions.length === 0 && query.measures.length > 0) {
        const m = query.measures[0].column as "sales" | "profit";
        const sum = syntheticRows.reduce((a, r) => a + r[m], 0);
        const alias = `${query.measures[0].aggregation}_${m}`;
        return {
          columns: [alias],
          rows: [{ [alias]: sum }],
          sql: "SELECT ...",
          executionMs: 2,
          rowCount: 1,
          truncated: false,
        };
      }

      const dim = query.dimensions[0].column as "category" | "sub_category" | "region" | "order_date";
      const groups = new Map<string, Record<string, unknown>>();
      for (const r of syntheticRows) {
        const key = dim === "order_date" ? r.order_date.slice(0, 7) : String(r[dim]);
        if (!groups.has(key)) {
          groups.set(key, { [dim === "order_date" ? "order_date_month" : dim]: key });
        }
        const entry = groups.get(key)!;
        for (const m of query.measures) {
          const alias = `${m.aggregation}_${m.column}`;
          const prev = Number(entry[alias] ?? 0);
          entry[alias] = prev + Number(r[m.column as "sales" | "profit"]);
        }
      }

      const rows = Array.from(groups.values());
      const firstMeasure = query.measures[0];
      if (firstMeasure) {
        const sortAlias = `${firstMeasure.aggregation}_${firstMeasure.column}`;
        rows.sort((a, b) => Number(b[sortAlias] ?? 0) - Number(a[sortAlias] ?? 0));
      }

      return {
        columns: Object.keys(rows[0] ?? {}),
        rows,
        sql: "SELECT ...",
        executionMs: 2,
        rowCount: rows.length,
        truncated: false,
      };
    },
  };

  return { deps, savedCharts, savedDashboards };
}

describe("QuackBoard v0.3.0 Agent Evaluation Suite", () => {
  it("Eval 1: completes multi-step tool loop (schema -> profile -> SQL -> variance -> charts -> dashboard)", async () => {
    const { deps, savedCharts, savedDashboards } = createEvalDeps();
    const res = await runAgentLoop({
      goal: "Investigate why profit differs across categories and build a diagnostic dashboard",
      datasets: [evalDataset],
      requireWriteApproval: false,
      stepPlanner: async ({ goal, datasets, history }) =>
        planNextLocalAgentStep({ goal, datasets, history }),
      executorDeps: deps,
    });

    expect(res.status).toBe("completed");
    const toolsUsed = new Set(res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
    expect(toolsUsed.has("inspect_schema")).toBe(true);
    expect(toolsUsed.has("profile_column")).toBe(true);
    expect(toolsUsed.has("run_sql_query")).toBe(true);
    expect(toolsUsed.has("analyze_variance")).toBe(true);
    expect(toolsUsed.has("create_chart")).toBe(true);
    expect(toolsUsed.has("create_dashboard")).toBe(true);
    expect(savedCharts.length).toBeGreaterThanOrEqual(3);
    expect(savedDashboards.length).toBe(1);
    expect(res.finalAnswer?.citations.length).toBeGreaterThan(0);
  });

  it("Eval 2: automatically self-heals when a SQL query fails mid-loop", async () => {
    const { deps } = createEvalDeps({ failFirstTotalsSql: true });
    const res = await runAgentLoop({
      goal: "Why is Furniture profit lower than Technology?",
      datasets: [evalDataset],
      requireWriteApproval: false,
      stepPlanner: async ({ goal, datasets, history }) =>
        planNextLocalAgentStep({ goal, datasets, history }),
      executorDeps: deps,
    });

    expect(res.status).toBe("completed");
    expect(res.steps.some((s) => s.selfRepaired === true)).toBe(true);
  });

  it("Eval 3: grounds final executive report strictly in real executed numbers", async () => {
    const { deps } = createEvalDeps();
    const res = await runAgentLoop({
      goal: "Analyze category sales and profit drivers",
      datasets: [evalDataset],
      requireWriteApproval: false,
      stepPlanner: async ({ goal, datasets, history }) =>
        planNextLocalAgentStep({ goal, datasets, history }),
      executorDeps: deps,
    });

    const combinedText = [
      res.finalAnswer?.headline,
      res.finalAnswer?.summary,
      ...(res.finalAnswer?.keyFindings ?? []),
      ...(res.finalAnswer?.rootCauses ?? []),
    ].join(" ");

    // Real total sales = 16,000, Technology = 8,200 (51.2% share), Technology margin = 28%
    expect(combinedText).toContain("Technology");
    expect(combinedText).toContain("$16,000");
    expect(combinedText).toContain("51.2%");
  });

  it("Eval 4: enforces read-only SQL guardrail and HITL write rejection", async () => {
    const { deps, savedCharts } = createEvalDeps();

    // Destructive SQL blocked cleanly at tool boundary
    const blockedSql = await executeAgentToolWithDeps(
      {
        toolCallId: "bad-sql",
        toolName: "run_sql_query",
        input: {
          datasetId: evalDataset.id,
          sql: "DROP TABLE superstore;",
          purpose: "Test safety",
        },
      },
      deps
    );
    expect(blockedSql.ok).toBe(false);
    expect(blockedSql.error).toMatch(/read-only/i);

    // HITL write approval skips chart/dashboard creation when rejected
    let approvalPrompts = 0;
    const res = await runAgentLoop({
      goal: "Analyze category profit and create a dashboard",
      datasets: [evalDataset],
      requireWriteApproval: true,
      onApprovalRequest: async () => {
        approvalPrompts += 1;
        return false; // User declines all write actions
      },
      stepPlanner: async ({ goal, datasets, history }: { goal: string; datasets: Dataset[]; history: AgentStepTrace[] }) =>
        planNextLocalAgentStep({ goal, datasets, history }),
      executorDeps: deps,
    });

    expect(res.status).toBe("completed");
    expect(approvalPrompts).toBeGreaterThan(0);
    expect(savedCharts.length).toBe(0);
  });
});
