import { describe, expect, it } from "vitest";
import { Dataset, QueryResult } from "../query/types";
import { validateReadOnlySql } from "../query/validator";
import {
  localAskToChart,
  localExplainInsights,
  localGenerateDashboard,
  localSqlCopilot,
} from "./local-fallback";
import { checkAiRateLimit } from "./rate-limit";

const sampleDataset: Dataset = {
  id: "sample-superstore",
  name: "Global Superstore Sales",
  sourceKind: "local_file",
  dialect: "duckdb",
  tableName: "superstore",
  rowCount: 2400,
  columns: [
    { name: "order_id", type: "string", role: "dimension" },
    { name: "order_date", type: "date", role: "dimension" },
    { name: "region", type: "string", role: "dimension" },
    { name: "segment", type: "string", role: "dimension" },
    { name: "category", type: "string", role: "dimension" },
    { name: "sub_category", type: "string", role: "dimension" },
    { name: "sales", type: "number", role: "measure" },
    { name: "profit", type: "number", role: "measure" },
    { name: "quantity", type: "number", role: "measure" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("AI local fallback suite", () => {
  it("parses natural language prompt into validated VisualQuery & chartType", () => {
    const res = localAskToChart(
      "Top 5 sub_category by profit as horizontal bar",
      sampleDataset
    );
    expect(res.chartType).toBe("horizontal_bar");
    expect(res.query.dimensions[0]?.column).toBe("sub_category");
    expect(res.query.measures[0]?.column).toBe("profit");
    expect(res.query.limit).toBe(5);
  });

  it("handles date trend prompts with monthly granularity", () => {
    const res = localAskToChart("Show monthly sales trend by category", sampleDataset);
    expect(res.query.dimensions[0]?.column).toBe("order_date");
    expect(res.query.dimensions[0]?.dateGranularity).toBe("month");
    expect(res.query.measures[0]?.column).toBe("sales");
    expect(res.query.colorBy?.column).toBe("category");
  });

  it("generates a balanced multi-tile dashboard blueprint", () => {
    const dash = localGenerateDashboard(sampleDataset, "Executive revenue overview");
    expect(dash.charts.length).toBeGreaterThanOrEqual(4);
    expect(dash.charts.some((c) => c.chartType === "kpi")).toBe(true);
    expect(dash.globalFilterColumns.length).toBeGreaterThan(0);
  });

  it("computes real statistical insights and follow-up questions", () => {
    const qr: QueryResult = {
      columns: ["region", "sum_sales"],
      rows: [
        { region: "North America", sum_sales: 1800000 },
        { region: "Europe", sum_sales: 1100000 },
        { region: "Asia Pacific", sum_sales: 850000 },
        { region: "Latin America", sum_sales: 450000 },
      ],
      sql: "SELECT ...",
      executionMs: 3,
      rowCount: 4,
      truncated: false,
    };

    const insights = localExplainInsights("Sales by Region", qr);
    expect(insights.headline).toContain("North America");
    expect(insights.bullets.length).toBeGreaterThanOrEqual(2);
    expect(insights.followUpQuestions.length).toBe(3);
  });

  it("generates read-only SQL in SQL Copilot fallback", () => {
    const res = localSqlCopilot({
      prompt: "Total sales and profit by region",
      dataset: sampleDataset,
    });
    expect(validateReadOnlySql(res.sql).valid).toBe(true);
    expect(res.sql).toContain('"superstore"');
  });

  it("enforces in-memory rate limits cleanly", () => {
    const key = `test-ip-${Date.now()}`;
    expect(checkAiRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(checkAiRateLimit(key, 2, 60_000).allowed).toBe(true);
    const blocked = checkAiRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
