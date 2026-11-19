import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compileVisualQuery } from "@/lib/query/compiler";
import { executeLiveSqlQuery } from "@/lib/engines/server-sql";
import { getServerSourceCredentials } from "@/lib/engines/source-store-server";
import { ColumnMeta, VisualQuery } from "@/lib/query/types";

const QueryRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("visual"),
    sourceId: z.string().min(1),
    tableName: z.string().min(1),
    schemaName: z.string().optional(),
    columns: z.array(z.any()),
    query: z.any(),
  }),
  z.object({
    mode: z.literal("sql"),
    sourceId: z.string().min(1),
    sql: z.string().min(1),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = QueryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const creds = await getServerSourceCredentials(parsed.data.sourceId);
    if (!creds) {
      return NextResponse.json(
        { error: "Database source not found. Please reconnect the data source." },
        { status: 404 }
      );
    }

    if (parsed.data.mode === "visual") {
      const compiled = compileVisualQuery(
        parsed.data.query as VisualQuery,
        parsed.data.tableName,
        parsed.data.columns as ColumnMeta[],
        creds.kind,
        parsed.data.schemaName
      );
      const result = await executeLiveSqlQuery({
        creds,
        sql: compiled.sql,
        values: compiled.params,
        previewSql: compiled.previewSql,
      });
      return NextResponse.json(result);
    }

    const result = await executeLiveSqlQuery({
      creds,
      sql: parsed.data.sql,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query execution error" },
      { status: 400 }
    );
  }
}
