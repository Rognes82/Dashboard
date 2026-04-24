import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
const CWD = process.cwd();

export async function POST() {
  const result = spawnSync(
    path.join(CWD, "node_modules", ".bin", "tsx"),
    ["scripts/sync-obsidian.ts", "--vault", VAULT_PATH],
    { cwd: CWD, timeout: 60_000, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    return NextResponse.json(
      { ok: false, error: result.stderr?.toString().slice(0, 500) ?? "seed failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
