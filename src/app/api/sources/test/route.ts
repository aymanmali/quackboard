import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testDatabaseConnection } from "@/lib/engines/server-sql";

const TestSchema = z.object({
  kind: z.enum(["postgres", "mysql"]),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().default(""),
  ssl: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid connection parameters" }, { status: 400 });
    }
    const result = await testDatabaseConnection(parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Test connection failed" },
      { status: 500 }
    );
  }
}
