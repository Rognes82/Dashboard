import { NextResponse } from "next/server";
import { listFiles } from "@/lib/queries/files";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
  return NextResponse.json({ files: listFiles(limit) });
}
