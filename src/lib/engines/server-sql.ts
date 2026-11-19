import { Pool as PgPool } from "pg";
import mysql from "mysql2/promise";
import { ColumnMeta, ColumnType, QueryResult } from "../query/types";
import { validateReadOnlySql } from "../query/validator";

export interface LiveDbCredentials {
  kind: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.QUACKBOARD_QUERY_TIMEOUT_MS ?? 15000);
const DEFAULT_MAX_ROWS = Number(process.env.QUACKBOARD_MAX_ROWS ?? 10000);

function mapSqlType(rawType: string): ColumnType {
  const upper = rawType.toUpperCase();
  if (
    upper.includes("INT") ||
    upper.includes("NUMERIC") ||
    upper.includes("DECIMAL") ||
    upper.includes("FLOAT") ||
    upper.includes("DOUBLE") ||
    upper.includes("REAL") ||
    upper.includes("MONEY")
  ) {
    return "number";
  }
  if (upper.includes("DATE") || upper.includes("TIME")) {
    return "date";
  }
  if (upper.includes("BOOL") || upper === "BIT") {
    return "boolean";
  }
  return "string";
}

export async function testDatabaseConnection(creds: LiveDbCredentials): Promise<{
  ok: boolean;
  serverVersion?: string;
  error?: string;
}> {
  if (creds.kind === "postgres") {
    const pool = new PgPool({
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.username,
      password: creds.password,
      ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
      max: 1,
    });
    try {
      const res = await pool.query("SELECT version() AS version");
      return { ok: true, serverVersion: String(res.rows[0]?.version ?? "PostgreSQL") };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
    } finally {
      await pool.end();
    }
  }

  // MySQL
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.username,
      password: creds.password,
      ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 8000,
    });
    const [rows] = await conn.query("SELECT VERSION() AS version");
    const first = (rows as Array<{ version?: string }>)[0];
    return { ok: true, serverVersion: String(first?.version ?? "MySQL") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  } finally {
    if (conn) await conn.end();
  }
}

export interface IntrospectedTable {
  schemaName: string;
  tableName: string;
  columns: ColumnMeta[];
}

export async function introspectDatabaseTables(
  creds: LiveDbCredentials
): Promise<IntrospectedTable[]> {
  if (creds.kind === "postgres") {
    const pool = new PgPool({
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.username,
      password: creds.password,
      ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
      max: 1,
    });

    try {
      const res = await pool.query(`
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position
        LIMIT 2000
      `);

      const grouped = new Map<string, IntrospectedTable>();
      for (const row of res.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            schemaName: row.table_schema,
            tableName: row.table_name,
            columns: [],
          });
        }
        const type = mapSqlType(String(row.data_type));
        const colName = String(row.column_name);
        const isIdLike = /(^id$|_id$)/i.test(colName);
        grouped.get(key)!.columns.push({
          name: colName,
          type,
          rawType: String(row.data_type),
          role: type === "number" && !isIdLike ? "measure" : "dimension",
        });
      }
      return Array.from(grouped.values());
    } finally {
      await pool.end();
    }
  }

  // MySQL
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    database: creds.database,
    user: creds.username,
    password: creds.password,
    ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 8000,
  });

  try {
    const [rows] = await conn.query(
      `
      SELECT TABLE_SCHEMA as table_schema, TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
      LIMIT 2000
      `,
      [creds.database]
    );

    const grouped = new Map<string, IntrospectedTable>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const schemaName = String(row.table_schema);
      const tableName = String(row.table_name);
      const key = `${schemaName}.${tableName}`;
      if (!grouped.has(key)) {
        grouped.set(key, { schemaName, tableName, columns: [] });
      }
      const type = mapSqlType(String(row.data_type));
      const colName = String(row.column_name);
      const isIdLike = /(^id$|_id$)/i.test(colName);
      grouped.get(key)!.columns.push({
        name: colName,
        type,
        rawType: String(row.data_type),
        role: type === "number" && !isIdLike ? "measure" : "dimension",
      });
    }
    return Array.from(grouped.values());
  } finally {
    await conn.end();
  }
}

export async function executeLiveSqlQuery(params: {
  creds: LiveDbCredentials;
  sql: string;
  values?: unknown[];
  previewSql?: string;
}): Promise<QueryResult> {
  const check = validateReadOnlySql(params.sql);
  if (!check.valid) {
    throw new Error(check.reason ?? "Query rejected by read-only validator.");
  }

  const start = Date.now();

  if (params.creds.kind === "postgres") {
    const pool = new PgPool({
      host: params.creds.host,
      port: params.creds.port,
      database: params.creds.database,
      user: params.creds.username,
      password: params.creds.password,
      ssl: params.creds.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
      statement_timeout: DEFAULT_TIMEOUT_MS,
      max: 1,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const res = await client.query(params.sql, params.values ?? []);
      await client.query("COMMIT");

      const executionMs = Date.now() - start;
      const columns = res.fields.map((f) => f.name);
      const truncated = res.rows.length > DEFAULT_MAX_ROWS;
      const rows = (truncated ? res.rows.slice(0, DEFAULT_MAX_ROWS) : res.rows) as Record<
        string,
        unknown
      >[];

      return {
        columns,
        rows,
        sql: params.previewSql ?? params.sql,
        executionMs,
        rowCount: rows.length,
        truncated,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
      await pool.end();
    }
  }

  // MySQL
  const conn = await mysql.createConnection({
    host: params.creds.host,
    port: params.creds.port,
    database: params.creds.database,
    user: params.creds.username,
    password: params.creds.password,
    ssl: params.creds.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 8000,
  });

  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const [rawRows, fields] = await conn.query({
      sql: params.sql,
      values: params.values ?? [],
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const executionMs = Date.now() - start;
    const allRows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
    const columns = Array.isArray(fields)
      ? fields.map((f) => f.name)
      : allRows[0]
      ? Object.keys(allRows[0])
      : [];
    const truncated = allRows.length > DEFAULT_MAX_ROWS;
    const rows = truncated ? allRows.slice(0, DEFAULT_MAX_ROWS) : allRows;

    return {
      columns,
      rows,
      sql: params.previewSql ?? params.sql,
      executionMs,
      rowCount: rows.length,
      truncated,
    };
  } finally {
    await conn.end();
  }
}
