import {
  AggregationFn,
  ColumnMeta,
  DateGranularity,
  DimensionField,
  MeasureField,
  QueryFilter,
  SqlDialect,
  VisualQuery,
} from "./types";
import { isValidIdentifier } from "./validator";

export interface CompiledQuery {
  sql: string;
  previewSql: string;
  params: unknown[];
  selectAliases: string[];
}

export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  if (dialect === "mysql") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid numeric filter value");
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

export function getDimensionAlias(dim: DimensionField): string {
  if (dim.alias) return dim.alias;
  if (dim.dateGranularity && dim.dateGranularity !== "raw") {
    return `${dim.column}_${dim.dateGranularity}`;
  }
  return dim.column;
}

export function getMeasureAlias(measure: MeasureField): string {
  if (measure.alias) return measure.alias;
  return `${measure.aggregation}_${measure.column}`;
}

function buildDateExpression(
  quotedCol: string,
  granularity: DateGranularity | undefined,
  dialect: SqlDialect
): string {
  if (!granularity || granularity === "raw") {
    return quotedCol;
  }

  if (dialect === "mysql") {
    switch (granularity) {
      case "day":
        return `DATE_FORMAT(${quotedCol}, '%Y-%m-%d')`;
      case "week":
        return `DATE_FORMAT(DATE_SUB(${quotedCol}, INTERVAL WEEKDAY(${quotedCol}) DAY), '%Y-%m-%d')`;
      case "month":
        return `DATE_FORMAT(${quotedCol}, '%Y-%m-01')`;
      case "quarter":
        return `CONCAT(YEAR(${quotedCol}), '-Q', QUARTER(${quotedCol}))`;
      case "year":
        return `DATE_FORMAT(${quotedCol}, '%Y-01-01')`;
    }
  }

  // DuckDB & PostgreSQL support DATE_TRUNC
  const castExpr =
    dialect === "duckdb" ? `CAST(${quotedCol} AS TIMESTAMP)` : `CAST(${quotedCol} AS TIMESTAMP)`;
  if (dialect === "duckdb") {
    return `STRFTIME(DATE_TRUNC('${granularity}', ${castExpr}), '%Y-%m-%d')`;
  }
  return `TO_CHAR(DATE_TRUNC('${granularity}', ${castExpr}), 'YYYY-MM-DD')`;
}

function buildMeasureExpression(
  quotedCol: string,
  aggregation: AggregationFn
): string {
  switch (aggregation) {
    case "sum":
      return `SUM(${quotedCol})`;
    case "avg":
      return `AVG(${quotedCol})`;
    case "count":
      return `COUNT(${quotedCol})`;
    case "count_distinct":
      return `COUNT(DISTINCT ${quotedCol})`;
    case "min":
      return `MIN(${quotedCol})`;
    case "max":
      return `MAX(${quotedCol})`;
  }
}

function assertColumnExists(columnName: string, columnMap: Map<string, ColumnMeta>): ColumnMeta {
  const meta = columnMap.get(columnName);
  if (!meta) {
    throw new Error(`Unknown column "${columnName}" in dataset schema.`);
  }
  return meta;
}

function compileFilterClause(
  filter: QueryFilter,
  columnMap: Map<string, ColumnMeta>,
  dialect: SqlDialect,
  params: unknown[],
  inlineParams: boolean
): { parameterized: string; preview: string } {
  const colMeta = assertColumnExists(filter.column, columnMap);
  const qCol = quoteIdentifier(colMeta.name, dialect);

  const nextPlaceholder = (val: unknown): { paramToken: string; previewToken: string } => {
    const previewToken = formatSqlLiteral(val);
    if (inlineParams) {
      return { paramToken: previewToken, previewToken };
    }
    params.push(val);
    const paramToken = dialect === "postgres" ? `$${params.length}` : "?";
    return { paramToken, previewToken };
  };

  switch (filter.operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (
        (filter.operator === "eq" || filter.operator === "neq") &&
        (filter.value === null || filter.value === undefined)
      ) {
        const nullClause = `${qCol} ${filter.operator === "eq" ? "IS NULL" : "IS NOT NULL"}`;
        return { parameterized: nullClause, preview: nullClause };
      }
      const opMap: Record<string, string> = {
        eq: "=",
        neq: "!=",
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
      };
      const op = opMap[filter.operator];
      const { paramToken, previewToken } = nextPlaceholder(filter.value);
      return {
        parameterized: `${qCol} ${op} ${paramToken}`,
        preview: `${qCol} ${op} ${previewToken}`,
      };
    }

    case "in":
    case "not_in": {
      const list = Array.isArray(filter.value) ? filter.value : [filter.value];
      if (list.length === 0) {
        const emptyClause = filter.operator === "in" ? "1 = 0" : "1 = 1";
        return { parameterized: emptyClause, preview: emptyClause };
      }
      const kw = filter.operator === "in" ? "IN" : "NOT IN";
      const tokens = list.map((v) => nextPlaceholder(v));
      return {
        parameterized: `${qCol} ${kw} (${tokens.map((t) => t.paramToken).join(", ")})`,
        preview: `${qCol} ${kw} (${tokens.map((t) => t.previewToken).join(", ")})`,
      };
    }

    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error(`Filter "between" requires exactly 2 values for column "${filter.column}".`);
      }
      const low = nextPlaceholder(filter.value[0]);
      const high = nextPlaceholder(filter.value[1]);
      return {
        parameterized: `${qCol} BETWEEN ${low.paramToken} AND ${high.paramToken}`,
        preview: `${qCol} BETWEEN ${low.previewToken} AND ${high.previewToken}`,
      };
    }

    case "contains": {
      const pattern = `%${String(filter.value)}%`;
      const { paramToken, previewToken } = nextPlaceholder(pattern);
      if (dialect === "mysql") {
        return {
          parameterized: `LOWER(CAST(${qCol} AS CHAR)) LIKE LOWER(${paramToken})`,
          preview: `LOWER(CAST(${qCol} AS CHAR)) LIKE LOWER(${previewToken})`,
        };
      }
      return {
        parameterized: `LOWER(CAST(${qCol} AS VARCHAR)) LIKE LOWER(${paramToken})`,
        preview: `LOWER(CAST(${qCol} AS VARCHAR)) LIKE LOWER(${previewToken})`,
      };
    }
  }
}

/**
 * Compiles a structured VisualQuery AST into dialect-safe SQL.
 * Validates all column references against the dataset schema to prevent SQL injection.
 */
export function compileVisualQuery(
  query: VisualQuery,
  tableName: string,
  columns: ColumnMeta[],
  dialect: SqlDialect,
  schemaName?: string
): CompiledQuery {
  if (!isValidIdentifier(tableName)) {
    throw new Error(`Invalid table identifier: "${tableName}"`);
  }
  if (schemaName && !isValidIdentifier(schemaName)) {
    throw new Error(`Invalid schema identifier: "${schemaName}"`);
  }

  const columnMap = new Map<string, ColumnMeta>(columns.map((c) => [c.name, c]));
  const qualifiedTable = schemaName
    ? `${quoteIdentifier(schemaName, dialect)}.${quoteIdentifier(tableName, dialect)}`
    : quoteIdentifier(tableName, dialect);

  const allDimensions: DimensionField[] = [...query.dimensions];
  if (
    query.colorBy &&
    !allDimensions.some(
      (d) =>
        d.column === query.colorBy?.column &&
        (d.dateGranularity ?? "raw") === (query.colorBy?.dateGranularity ?? "raw")
    )
  ) {
    allDimensions.push(query.colorBy);
  }

  const selectClauses: string[] = [];
  const groupByClauses: string[] = [];
  const selectAliases: string[] = [];
  const validAliasSet = new Set<string>();

  // If no dimensions and no measures selected, return raw preview of first columns
  if (allDimensions.length === 0 && query.measures.length === 0) {
    const previewCols = columns.slice(0, 12);
    for (const c of previewCols) {
      selectClauses.push(quoteIdentifier(c.name, dialect));
      selectAliases.push(c.name);
      validAliasSet.add(c.name);
    }
  } else {
    for (const dim of allDimensions) {
      const meta = assertColumnExists(dim.column, columnMap);
      const qCol = quoteIdentifier(meta.name, dialect);
      const expr =
        meta.type === "date"
          ? buildDateExpression(qCol, dim.dateGranularity, dialect)
          : qCol;
      const alias = getDimensionAlias(dim);
      const qAlias = quoteIdentifier(alias, dialect);
      selectClauses.push(`${expr} AS ${qAlias}`);
      groupByClauses.push(expr);
      selectAliases.push(alias);
      validAliasSet.add(alias);
    }

    for (const measure of query.measures) {
      const meta = assertColumnExists(measure.column, columnMap);
      const qCol = quoteIdentifier(meta.name, dialect);
      const expr = buildMeasureExpression(qCol, measure.aggregation);
      const alias = getMeasureAlias(measure);
      const qAlias = quoteIdentifier(alias, dialect);
      selectClauses.push(`${expr} AS ${qAlias}`);
      selectAliases.push(alias);
      validAliasSet.add(alias);
    }
  }

  // Filters
  const inlineParams = dialect === "duckdb";
  const params: unknown[] = [];
  const whereParamClauses: string[] = [];
  const wherePreviewClauses: string[] = [];

  for (const filter of query.filters ?? []) {
    const compiled = compileFilterClause(filter, columnMap, dialect, params, inlineParams);
    whereParamClauses.push(compiled.parameterized);
    wherePreviewClauses.push(compiled.preview);
  }

  // Order By
  const orderByClauses: string[] = [];
  if (query.sort && query.sort.length > 0) {
    for (const s of query.sort) {
      if (!validAliasSet.has(s.field) && !columnMap.has(s.field)) {
        throw new Error(`Cannot sort by unknown field "${s.field}".`);
      }
      const dir = s.direction === "desc" ? "DESC" : "ASC";
      orderByClauses.push(`${quoteIdentifier(s.field, dialect)} ${dir}`);
    }
  } else if (allDimensions.length > 0) {
    const firstDim = allDimensions[0];
    const firstMeta = columnMap.get(firstDim.column);
    if (firstMeta?.type === "date") {
      orderByClauses.push(`${quoteIdentifier(getDimensionAlias(firstDim), dialect)} ASC`);
    } else if (query.measures.length > 0) {
      orderByClauses.push(`${quoteIdentifier(getMeasureAlias(query.measures[0]), dialect)} DESC`);
    }
  }

  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 500)), 10000);

  const assemble = (whereClauses: string[]) => {
    const parts: string[] = [
      `SELECT\n  ${selectClauses.join(",\n  ")}`,
      `FROM ${qualifiedTable}`,
    ];
    if (whereClauses.length > 0) {
      parts.push(`WHERE ${whereClauses.join("\n  AND ")}`);
    }
    if (groupByClauses.length > 0 && query.measures.length > 0) {
      parts.push(`GROUP BY ${groupByClauses.join(", ")}`);
    } else if (groupByClauses.length > 0 && query.measures.length === 0) {
      parts.push(`GROUP BY ${groupByClauses.join(", ")}`);
    }
    if (orderByClauses.length > 0) {
      parts.push(`ORDER BY ${orderByClauses.join(", ")}`);
    }
    parts.push(`LIMIT ${limit}`);
    return parts.join("\n");
  };

  return {
    sql: assemble(whereParamClauses),
    previewSql: assemble(wherePreviewClauses),
    params,
    selectAliases,
  };
}
