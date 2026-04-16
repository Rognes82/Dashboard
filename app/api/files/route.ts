import { NextResponse } from "next/server";
import { listFiles } from "@/lib/queries/files";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 500);
  return NextResponse.json({ files: listFiles(limit) });
}
