import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVaultNoteById } from "@/lib/queries/vault-notes";
import { listBinsForNote } from "@/lib/queries/bins";
import { getVaultPath } from "@/lib/vault/path";

const VAULT_PATH = getVaultPath();

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const note = getVaultNoteById(params.id);
  if (!note || note.deleted_at) return NextResponse.json({ error: "not found" }, { status: 404 });

  const abs = path.join(VAULT_PATH, note.vault_path);
  let content = "";
  try {
    content = fs.readFileSync(abs, "utf-8");
  } catch {
    return NextResponse.json({ error: "note file missing on disk" }, { status: 500 });
  }

  const bins = listBinsForNote(note.id);
  return NextResponse.json({ note, content, bins });
}
