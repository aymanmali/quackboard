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

  it("handles comment markers inside strings and apostrophes inside comments", () => {
    expect(
      validateReadOnlySql("SELECT '-- not a comment' AS note, '/* also text */' AS note2 FROM superstore").valid
    ).toBe(true);
    expect(
      validateReadOnlySql("SELECT '-- DROP TABLE users' FROM superstore").valid
    ).toBe(true);
    expect(
      validateReadOnlySql("-- don't drop this\nSELECT * FROM superstore WHERE status = 'ok'").valid
    ).toBe(true);
    expect(
      validateReadOnlySql("SELECT '-- ok' FROM superstore; DROP TABLE superstore").valid
    ).toBe(false);
  });
});
