import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
const CWD = process.cwd();

export async function POST() {
  const result = spawnSync(
    path.join(CWD, "node_modules", ".bin", "tsx"),
    ["scripts/sync-notion.ts"],
    {
      cwd: CWD,
      timeout: 120_000,
      encoding: "utf-8",
      env: { ...process.env, VAULT_PATH },
    }
  );
  if (result.status !== 0) {
    return NextResponse.json(
      { ok: false, error: result.stderr?.toString().slice(0, 500) ?? "sync-notion failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
