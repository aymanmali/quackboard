import { describe, expect, it } from "vitest";
import { compileVisualQuery } from "./compiler";
import { ColumnMeta, VisualQuery } from "./types";

const sampleColumns: ColumnMeta[] = [
  { name: "order_date", type: "date", role: "dimension" },
  { name: "region", type: "string", role: "dimension" },
  { name: "category", type: "string", role: "dimension" },
  { name: "sales", type: "number", role: "measure" },
  { name: "profit", type: "number", role: "measure" },
];

describe("compileVisualQuery", () => {
  it("compiles a DuckDB monthly trend query with color breakdown and filters", () => {
    const query: VisualQuery = {
      datasetId: "superstore",
      dimensions: [{ column: "order_date", dateGranularity: "month" }],
      measures: [{ column: "sales", aggregation: "sum" }],
      colorBy: { column: "region" },
      filters: [
        { column: "category", operator: "in", value: ["Technology", "Furniture"] },
        { column: "sales", operator: "gte", value: 100 },
      ],
      limit: 200,
    };

    const compiled = compileVisualQuery(query, "superstore", sampleColumns, "duckdb");
    expect(compiled.sql).toContain(`DATE_TRUNC('month', CAST("order_date" AS TIMESTAMP))`);
    expect(compiled.sql).toContain(`SUM("sales") AS "sum_sales"`);
    expect(compiled.sql).toContain(`"category" IN ('Technology', 'Furniture')`);
    expect(compiled.sql).toContain(`"sales" >= 100`);
    expect(compiled.sql).toContain(`GROUP BY`);
    expect(compiled.sql).toContain(`LIMIT 200`);
    expect(compiled.params).toHaveLength(0);
  });

  it("compiles parameterized PostgreSQL SQL ($1, $2) with schema qualification", () => {
    const query: VisualQuery = {
      datasetId: "orders",
      dimensions: [{ column: "region" }],
      measures: [
        { column: "sales", aggregation: "sum" },
        { column: "profit", aggregation: "avg" },
      ],
      filters: [
        { column: "region", operator: "eq", value: "Europe" },
        { column: "category", operator: "contains", value: "Tech" },
      ],
      sort: [{ field: "sum_sales", direction: "desc" }],
    };

    const compiled = compileVisualQuery(query, "orders", sampleColumns, "postgres", "public");
    expect(compiled.sql).toContain(`FROM "public"."orders"`);
    expect(compiled.sql).toContain(`"region" = $1`);
    expect(compiled.sql).toContain(`LIKE LOWER($2)`);
    expect(compiled.params).toEqual(["Europe", "%Tech%"]);
    expect(compiled.previewSql).toContain(`'Europe'`);
  });

  it("compiles MySQL backtick identifiers and DATE_FORMAT date bucketing", () => {
    const query: VisualQuery = {
      datasetId: "orders",
      dimensions: [{ column: "order_date", dateGranularity: "quarter" }],
      measures: [{ column: "sales", aggregation: "count_distinct" }],
      filters: [{ column: "sales", operator: "between", value: [10, 500] }],
    };

    const compiled = compileVisualQuery(query, "orders", sampleColumns, "mysql");
    expect(compiled.sql).toContain("FROM `orders`");
    expect(compiled.sql).toContain("CONCAT(YEAR(`order_date`), '-Q', QUARTER(`order_date`))");
    expect(compiled.sql).toContain("COUNT(DISTINCT `sales`) AS `count_distinct_sales`");
    expect(compiled.sql).toContain("`sales` BETWEEN ? AND ?");
    expect(compiled.params).toEqual([10, 500]);
  });

  it("rejects unknown columns to prevent SQL injection", () => {
    const query: VisualQuery = {
      datasetId: "superstore",
      dimensions: [{ column: "region; DROP TABLE superstore;--" }],
      measures: [{ column: "sales", aggregation: "sum" }],
      filters: [],
    };

    expect(() =>
      compileVisualQuery(query, "superstore", sampleColumns, "duckdb")
    ).toThrow(/Unknown column/);
  });

  it("rejects invalid table identifiers", () => {
    const query: VisualQuery = {
      datasetId: "superstore",
      dimensions: [{ column: "region" }],
      measures: [],
      filters: [],
    };

    expect(() =>
      compileVisualQuery(query, "users; DROP TABLE users", sampleColumns, "postgres")
    ).toThrow(/Invalid table identifier/);
  });

  it("compiles eq/neq null filters as IS NULL and IS NOT NULL without extra bind params", () => {
    const query: VisualQuery = {
      datasetId: "orders",
      dimensions: [{ column: "region" }],
      measures: [{ column: "sales", aggregation: "sum" }],
      filters: [
        { column: "region", operator: "eq", value: null },
        { column: "category", operator: "neq", value: null },
        { column: "sales", operator: "gt", value: 50 },
      ],
    };

    const compiled = compileVisualQuery(query, "orders", sampleColumns, "postgres");
    expect(compiled.sql).toContain(`"region" IS NULL`);
    expect(compiled.sql).toContain(`"category" IS NOT NULL`);
    expect(compiled.sql).toContain(`"sales" > $1`);
    expect(compiled.params).toEqual([50]);
  });

  it("compiles empty IN filter to 1 = 0 and empty NOT IN filter to 1 = 1", () => {
    const emptyIn = compileVisualQuery(
      {
        datasetId: "orders",
        dimensions: [{ column: "region" }],
        measures: [],
        filters: [{ column: "region", operator: "in", value: [] }],
      },
      "orders",
      sampleColumns,
      "duckdb"
    );
    expect(emptyIn.sql).toContain("WHERE 1 = 0");

    const emptyNotIn = compileVisualQuery(
      {
        datasetId: "orders",
        dimensions: [{ column: "region" }],
        measures: [],
        filters: [{ column: "region", operator: "not_in", value: [] }],
      },
      "orders",
      sampleColumns,
      "duckdb"
    );
    expect(emptyNotIn.sql).toContain("WHERE 1 = 1");
  });
});
