"use client";

import { Dataset, QueryResult, VisualQuery } from "../query/types";
import { getDatasetFileBytes } from "../storage/indexeddb-store";
import {
  ensureTableLoaded,
  getDuckDBDistinctValues,
  runDuckDBRawSql,
  runDuckDBVisualQuery,
} from "./duckdb-client";

/**
 * Executes a VisualQuery transparently on either DuckDB-Wasm (local files)
 * or the Next.js server API (live PostgreSQL / MySQL databases).
 */
export async function executeVisualQuery(
  dataset: Dataset,
  query: VisualQuery
): Promise<QueryResult> {
  if (dataset.sourceKind === "local_file") {
    await ensureTableLoaded({
      tableName: dataset.tableName,
      fileName: dataset.fileName,
      fileUrl: dataset.fileUrl,
      getStoredBytes: () => getDatasetFileBytes(dataset.id),
    });

    return runDuckDBVisualQuery({
      query,
      tableName: dataset.tableName,
      columns: dataset.columns,
    });
  }

  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "visual",
      sourceId: dataset.sourceId,
      tableName: dataset.tableName,
      schemaName: dataset.schemaName,
      columns: dataset.columns,
      query,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to execute live database query");
  }
  return data as QueryResult;
}

/**
 * Executes read-only ad-hoc SQL against either DuckDB-Wasm or a saved live DB source.
 */
export async function executeAdHocSql(params: {
  dataset?: Dataset;
  sourceId?: string;
  sql: string;
}): Promise<QueryResult> {
  if (params.dataset && params.dataset.sourceKind === "local_file") {
    await ensureTableLoaded({
      tableName: params.dataset.tableName,
      fileName: params.dataset.fileName,
      fileUrl: params.dataset.fileUrl,
      getStoredBytes: () => getDatasetFileBytes(params.dataset!.id),
    });
    return runDuckDBRawSql(params.sql);
  }

  if (!params.sourceId && !params.dataset?.sourceId) {
    return runDuckDBRawSql(params.sql);
  }

  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "sql",
      sourceId: params.sourceId ?? params.dataset?.sourceId,
      sql: params.sql,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "SQL execution failed");
  }
  return data as QueryResult;
}

/**
 * Fetches distinct values for a column (used for filter dropdowns).
 */
export async function fetchDistinctColumnValues(
  dataset: Dataset,
  columnName: string
): Promise<string[]> {
  if (dataset.sourceKind === "local_file") {
    await ensureTableLoaded({
      tableName: dataset.tableName,
      fileName: dataset.fileName,
      fileUrl: dataset.fileUrl,
      getStoredBytes: () => getDatasetFileBytes(dataset.id),
    });
    return getDuckDBDistinctValues(dataset.tableName, columnName, 100);
  }

  const res = await executeVisualQuery(dataset, {
    datasetId: dataset.id,
    dimensions: [{ column: columnName }],
    measures: [],
    filters: [],
    limit: 100,
  });
  return res.rows
    .map((r) => r[columnName])
    .filter((v) => v !== null && v !== undefined)
    .map(String);
}
