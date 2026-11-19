import { describe, expect, it } from "vitest";
import { validateReadOnlySql } from "./validator";

describe("validateReadOnlySql", () => {
  it("allows standard SELECT and CTE queries", () => {
    expect(validateReadOnlySql("SELECT region, SUM(sales) FROM superstore GROUP BY 1;").valid).toBe(true);
    expect(
      validateReadOnlySql(
        "WITH top_regions AS (SELECT region FROM superstore) SELECT * FROM top_regions"
      ).valid
    ).toBe(true);
  });

  it("blocks destructive DDL/DML statements", () => {
    expect(validateReadOnlySql("DROP TABLE superstore").valid).toBe(false);
    expect(validateReadOnlySql("DELETE FROM superstore WHERE 1=1").valid).toBe(false);
    expect(validateReadOnlySql("SELECT * FROM superstore; DROP TABLE superstore;").valid).toBe(false);
    expect(validateReadOnlySql("SELECT * FROM superstore WHERE name = 'ok'; UPDATE superstore SET sales=0").valid).toBe(false);
  });

  it("allows keywords when safely inside string literals or comments", () => {
    expect(
      validateReadOnlySql("SELECT * FROM superstore WHERE category = 'DROP AND DELETE' -- update test").valid
    ).toBe(true);
  });
});
