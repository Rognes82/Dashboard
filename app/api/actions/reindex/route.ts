import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";
import { getVaultPath } from "@/lib/vault/path";

const VAULT_PATH = getVaultPath();
const CWD = process.cwd();

export async function POST() {
  const result = spawnSync(
    path.join(CWD, "node_modules", ".bin", "tsx"),
    ["scripts/vault-indexer.ts", "--vault", VAULT_PATH],
    { cwd: CWD, timeout: 60_000, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    return NextResponse.json(
      { ok: false, error: result.stderr?.toString().slice(0, 500) ?? "indexer failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
