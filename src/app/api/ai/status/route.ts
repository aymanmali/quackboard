import { NextResponse } from "next/server";
import { getServerAiStatus } from "@/lib/ai/provider";

export async function GET() {
  return NextResponse.json(getServerAiStatus());
}
