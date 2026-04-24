import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVaultNoteByPath } from "@/lib/queries/vault-notes";
import { listBinsForNote } from "@/lib/queries/bins";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const p = searchParams.get("path");
  if (!p) return NextResponse.json({ error: "path required" }, { status: 400 });
  const note = getVaultNoteByPath(p);
  if (!note || note.deleted_at) return NextResponse.json({ error: "not found" }, { status: 404 });
  let content = "";
  try {
    content = fs.readFileSync(path.join(VAULT_PATH, note.vault_path), "utf-8");
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 500 });
  }
  const bins = listBinsForNote(note.id);
  return NextResponse.json({ note, content, bins });
}
