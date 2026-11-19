import { describe, expect, it } from "vitest";
import { buildEChartsOption, formatNumericValue, resolveChartType } from "./echarts-builder";
import { ColumnMeta, QueryResult, VisualQuery } from "../query/types";

const cols: ColumnMeta[] = [
  { name: "order_date", type: "date", role: "dimension" },
  { name: "region", type: "string", role: "dimension" },
  { name: "sales", type: "number", role: "measure" },
  { name: "profit", type: "number", role: "measure" },
];

describe("echarts-builder", () => {
  it("auto-resolves appropriate chart types", () => {
    const base = { datasetId: "d1", filters: [] };
    expect(
      resolveChartType("auto", { ...base, dimensions: [], measures: [{ column: "sales", aggregation: "sum" }] }, cols)
    ).toBe("kpi");
    expect(
      resolveChartType(
        "auto",
        { ...base, dimensions: [{ column: "order_date", dateGranularity: "month" }], measures: [{ column: "sales", aggregation: "sum" }] },
        cols
      )
    ).toBe("area");
    expect(
      resolveChartType(
        "auto",
        { ...base, dimensions: [{ column: "region" }], measures: [{ column: "sales", aggregation: "sum" }] },
        cols
      )
    ).toBe("bar");
  });

  it("builds multi-series stacked bar ECharts config when colorBy is present", () => {
    const query: VisualQuery = {
      datasetId: "d1",
      dimensions: [{ column: "region" }],
      measures: [{ column: "sales", aggregation: "sum" }],
      colorBy: { column: "order_date", dateGranularity: "year" },
      filters: [],
    };
    const result: QueryResult = {
      columns: ["region", "order_date_year", "sum_sales"],
      rows: [
        { region: "Europe", order_date_year: "2024-01-01", sum_sales: 1200 },
        { region: "Europe", order_date_year: "2025-01-01", sum_sales: 1500 },
        { region: "North America", order_date_year: "2024-01-01", sum_sales: 2100 },
      ],
      sql: "SELECT ...",
      executionMs: 4,
      rowCount: 3,
      truncated: false,
    };

    const opt = buildEChartsOption({
      chartType: "stacked_bar",
      query,
      result,
      columns: cols,
      theme: "light",
    });

    expect(Array.isArray(opt.series)).toBe(true);
    expect((opt.series as unknown[]).length).toBe(2);
  });

  it("formats currency, percent, and compact numbers cleanly", () => {
    expect(formatNumericValue(12500, "currency")).toBe("$12,500");
    expect(formatNumericValue(0.245, "percent")).toBe("24.5%");
    expect(formatNumericValue(1_500_000, "compact")).toBe("1.5M");
  });
});
