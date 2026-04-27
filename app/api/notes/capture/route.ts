import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { captureSlug, captureFilename } from "@/lib/capture/slug";
import { getBinById } from "@/lib/queries/bins";
import { getVaultNoteByPath } from "@/lib/queries/vault-notes";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";
import { nowIso } from "@/lib/utils";
import { getVaultPath } from "@/lib/vault/path";

const VAULT_PATH = getVaultPath();
const CAPTURE_FOLDER = process.env.CAPTURE_FOLDER ?? "captures";
const CWD = process.cwd();

function buildFrontmatter(fields: { bin_id: string; tags: string[]; created_at: string }): string {
  const lines = [
    "---",
    "source: capture",
    `created_at: ${fields.created_at}`,
    `bins: [${fields.bin_id}]`,
  ];
  if (fields.tags.length > 0) {
    lines.push(`tags: [${fields.tags.join(", ")}]`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.content, 10_000)) return badRequest("content required (<=10k chars)");
  if (!isNonEmptyString(b.bin_id, 32)) return badRequest("bin_id required");

  const bin = getBinById(b.bin_id as string);
  if (!bin) return NextResponse.json({ error: "bin not found" }, { status: 404 });

  const tags = Array.isArray(b.tags)
    ? (b.tags as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 64).slice(0, 20)
    : [];

  const content = (b.content as string).trim();
  const now = new Date();
  const createdIso = now.toISOString();
  const slug = captureSlug(content);
  const filename = captureFilename(now, slug);
  const relPath = path.posix.join(CAPTURE_FOLDER, filename);
  const absPath = path.join(VAULT_PATH, relPath);

  // Ensure capture directory exists
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  // Atomic write: write to .tmp, rename
  const tmpPath = absPath + ".tmp";
  const fileBody = buildFrontmatter({ bin_id: bin.id, tags, created_at: createdIso }) + content + "\n";
  fs.writeFileSync(tmpPath, fileBody, "utf-8");
  fs.renameSync(tmpPath, absPath);

  // Spawn single-file indexer pass; non-fatal if it fails (cron will pick it up)
  let indexed = false;
  let reason: string | undefined;
  try {
    const result = spawnSync(
      path.join(CWD, "node_modules", ".bin", "tsx"),
      ["scripts/vault-indexer.ts", "--vault", VAULT_PATH, "--file", relPath],
      { cwd: CWD, timeout: 5000, encoding: "utf-8" }
    );
    if (result.status === 0) {
      indexed = true;
    } else {
      reason = result.stderr?.toString().slice(0, 200) ?? `exit ${result.status}`;
    }
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }

  // Best-effort: resolve the note ID if indexer succeeded
  const note = indexed ? getVaultNoteByPath(relPath) : null;

  return NextResponse.json({
    ok: true,
    note_id: note?.id ?? null,
    vault_path: relPath,
    indexed,
    reason,
    captured_at: createdIso,
  });
}
