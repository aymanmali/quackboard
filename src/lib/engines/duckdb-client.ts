"use client";

import * as duckdb from "@duckdb/duckdb-wasm";
import * as XLSX from "xlsx";
import { ColumnMeta, ColumnType, QueryResult, VisualQuery } from "../query/types";
import { compileVisualQuery, quoteIdentifier } from "../query/compiler";
import { validateReadOnlySql } from "../query/validator";

let dbInstance: duckdb.AsyncDuckDB | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;
const registeredTables = new Set<string>();

function mapDuckTypeToColumnType(rawType: string): ColumnType {
  const upper = rawType.toUpperCase();
  if (
    upper.includes("INT") ||
    upper.includes("DOUBLE") ||
    upper.includes("FLOAT") ||
    upper.includes("DECIMAL") ||
    upper.includes("NUMERIC") ||
    upper.includes("HUGEINT") ||
    upper.includes("REAL")
  ) {
    return "number";
  }
  if (upper.includes("DATE") || upper.includes("TIMESTAMP") || upper.includes("TIME")) {
    return "date";
  }
  if (upper.includes("BOOL")) {
    return "boolean";
  }
  return "string";
}

function normalizeCellValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === "bigint") {
    const asNum = Number(val);
    return Number.isSafeInteger(asNum) ? asNum : val.toString();
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "object" && val !== null) {
    // Handle DuckDB Decimal / Arrow structs gracefully
    const maybeToString = (val as { toString?: () => string }).toString;
    if (typeof maybeToString === "function" && maybeToString !== Object.prototype.toString) {
      const str = maybeToString.call(val);
      const asNum = Number(str);
      return Number.isFinite(asNum) && str.trim() !== "" ? asNum : str;
    }
  }
  return val;
}

export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: `${origin}/duckdb/duckdb-mvp.wasm`,
        mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js`,
      },
      eh: {
        mainModule: `${origin}/duckdb/duckdb-eh.wasm`,
        mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js`,
      },
    };

    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const workerUrl = bundle.mainWorker!;
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    dbInstance = db;
    return db;
  })();

  return initPromise;
}

export function sanitizeTableName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const safe = cleaned.length > 0 ? cleaned : "dataset";
  return /^[0-9]/.test(safe) ? `t_${safe}` : safe.slice(0, 60);
}

export async function ingestFileIntoDuckDB(params: {
  tableName: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<{ columns: ColumnMeta[]; rowCount: number }> {
  const db = await getDuckDB();
  const conn = await db.connect();

  try {
    const ext = params.fileName.split(".").pop()?.toLowerCase() ?? "csv";
    const qTable = quoteIdentifier(params.tableName, "duckdb");

    if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.read(params.bytes, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        throw new Error("Excel workbook contains no sheets.");
      }
      const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);
      const virtualFile = `${params.tableName}.csv`;
      await db.registerFileText(virtualFile, csvText);
      await conn.query(
        `CREATE OR REPLACE TABLE ${qTable} AS SELECT * FROM read_csv_auto('${virtualFile}', header=true)`
      );
    } else if (ext === "parquet") {
      const virtualFile = `${params.tableName}.parquet`;
      await db.registerFileBuffer(virtualFile, params.bytes);
      await conn.query(
        `CREATE OR REPLACE TABLE ${qTable} AS SELECT * FROM read_parquet('${virtualFile}')`
      );
    } else if (ext === "json" || ext === "ndjson") {
      const virtualFile = `${params.tableName}.json`;
      await db.registerFileBuffer(virtualFile, params.bytes);
      await conn.query(
        `CREATE OR REPLACE TABLE ${qTable} AS SELECT * FROM read_json_auto('${virtualFile}')`
      );
    } else {
      // CSV / TSV
      const virtualFile = `${params.tableName}.${ext === "tsv" ? "tsv" : "csv"}`;
      await db.registerFileBuffer(virtualFile, params.bytes);
      await conn.query(
        `CREATE OR REPLACE TABLE ${qTable} AS SELECT * FROM read_csv_auto('${virtualFile}', header=true)`
      );
    }

    registeredTables.add(params.tableName);

    const describeRes = await conn.query(`DESCRIBE ${qTable}`);
    const columns: ColumnMeta[] = describeRes.toArray().map((row) => {
      const obj = row.toJSON() as Record<string, unknown>;
      const colName = String(obj.column_name ?? obj.name ?? "");
      const rawType = String(obj.column_type ?? obj.type ?? "VARCHAR");
      const type = mapDuckTypeToColumnType(rawType);
      const isIdLike = /(^id$|_id$|^zip|^postal|^year$)/i.test(colName);
      return {
        name: colName,
        type,
        rawType,
        role: type === "number" && !isIdLike ? "measure" : "dimension",
      };
    });

    const countRes = await conn.query(`SELECT COUNT(*) AS cnt FROM ${qTable}`);
    const countObj = countRes.toArray()[0]?.toJSON() as Record<string, unknown> | undefined;
    const rowCount = Number(countObj?.cnt ?? 0);

    return { columns, rowCount };
  } finally {
    await conn.close();
  }
}

export async function ensureTableLoaded(params: {
  tableName: string;
  fileName?: string;
  fileUrl?: string;
  getStoredBytes?: () => Promise<Uint8Array | null>;
}): Promise<void> {
  if (registeredTables.has(params.tableName)) return;

  let bytes: Uint8Array | null = null;
  if (params.getStoredBytes) {
    bytes = await params.getStoredBytes();
  }
  if (!bytes && params.fileUrl) {
    const res = await fetch(params.fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch sample dataset from ${params.fileUrl}`);
    }
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
  }
  if (!bytes) {
    throw new Error(
      `Local dataset "${params.tableName}" is not loaded in memory. Please re-upload the file.`
    );
  }

  await ingestFileIntoDuckDB({
    tableName: params.tableName,
    fileName: params.fileName ?? `${params.tableName}.csv`,
    bytes,
  });
}

export async function runDuckDBRawSql(sql: string, maxRows = 5000): Promise<QueryResult> {
  const check = validateReadOnlySql(sql);
  if (!check.valid) {
    throw new Error(check.reason ?? "Query rejected by read-only validator.");
  }

  const db = await getDuckDB();
  const conn = await db.connect();
  const start = performance.now();

  try {
    const arrowTable = await conn.query(sql);
    const executionMs = Math.round(performance.now() - start);
    const columns = arrowTable.schema.fields.map((f) => f.name);
    const rawRows = arrowTable.toArray();
    const truncated = rawRows.length > maxRows;
    const sliced = truncated ? rawRows.slice(0, maxRows) : rawRows;

    const rows: Record<string, unknown>[] = sliced.map((r) => {
      const json = r.toJSON() as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const col of columns) {
        clean[col] = normalizeCellValue(json[col]);
      }
      return clean;
    });

    return {
      columns,
      rows,
      sql,
      executionMs,
      rowCount: rows.length,
      truncated,
    };
  } finally {
    await conn.close();
  }
}

export async function runDuckDBVisualQuery(params: {
  query: VisualQuery;
  tableName: string;
  columns: ColumnMeta[];
}): Promise<QueryResult> {
  const compiled = compileVisualQuery(params.query, params.tableName, params.columns, "duckdb");
  const result = await runDuckDBRawSql(compiled.sql, params.query.limit ?? 1000);
  return {
    ...result,
    sql: compiled.previewSql,
  };
}

export async function getDuckDBDistinctValues(
  tableName: string,
  columnName: string,
  limit = 100
): Promise<string[]> {
  const qTable = quoteIdentifier(tableName, "duckdb");
  const qCol = quoteIdentifier(columnName, "duckdb");
  const res = await runDuckDBRawSql(
    `SELECT DISTINCT CAST(${qCol} AS VARCHAR) AS val FROM ${qTable} WHERE ${qCol} IS NOT NULL ORDER BY 1 ASC LIMIT ${limit}`
  );
  return res.rows.map((r) => String(r.val ?? ""));
}
