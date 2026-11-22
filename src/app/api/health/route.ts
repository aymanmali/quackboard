import { NextResponse } from "next/server";
import { isPostgresConfigured } from "@/db";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "QuackBoard",
    version: "0.2.0",
    storageMode: isPostgresConfigured() ? "postgres" : "local-indexeddb",
  });
}
