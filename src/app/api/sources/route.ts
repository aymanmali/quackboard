import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { introspectDatabaseTables, testDatabaseConnection } from "@/lib/engines/server-sql";
import {
  deleteServerSource,
  listServerSources,
  saveServerSource,
} from "@/lib/engines/source-store-server";

const CreateSourceSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["postgres", "mysql"]),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().default(""),
  ssl: z.boolean().default(false),
});

export async function GET() {
  try {
    const sources = await listServerSources();
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list sources" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateSourceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid connection payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, ...creds } = parsed.data;
    const test = await testDatabaseConnection(creds);
    if (!test.ok) {
      return NextResponse.json(
        { error: `Connection failed: ${test.error}` },
        { status: 400 }
      );
    }

    const source = await saveServerSource({ name, creds });
    const tables = await introspectDatabaseTables(creds);

    return NextResponse.json({
      source,
      tables,
      serverVersion: test.serverVersion,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save database source" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing source id" }, { status: 400 });
  }
  await deleteServerSource(id);
  return NextResponse.json({ ok: true });
}
