import fs from "fs";
import path from "path";
import { closeDb } from "../lib/db";
import { nowIso, slugify } from "../lib/utils";
import { hashContent } from "../lib/vault/hash";
import { NotionClient, extractPageTitle, type NotionPage } from "../lib/notion/client";
import { blocksToMarkdown } from "../lib/notion/blocks-to-markdown";
import { parseCursor, serializeCursor, updateCursor, getDbCursor } from "../lib/notion/cursor";
import { getSettingJson } from "../lib/queries/app-settings";
import { recordSyncRun, readSyncCursor } from "../lib/queries/sync-status";
import {
  upsertVaultNote,
  getVaultNoteBySourceId,
  updateFtsRow,
} from "../lib/queries/vault-notes";
import { parseFrontmatter, extractInlineTags } from "../lib/vault/frontmatter";
import { markdownToPlainText, deriveTitle } from "../lib/vault/markdown";

// Abstraction so tests can inject a fake client without hitting Notion
export interface SyncNotionPage {
  id: string;
  url: string;
  title: string;
  last_edited_time: string;
  markdown: string; // rendered markdown body (no frontmatter)
}

export interface NotionSyncDeps {
  client: {
    getDatabase(id: string): Promise<{ id: string; title: string }>;
    queryPages(db_id: string, since?: string): Promise<SyncNotionPage[]>;
  };
  vaultPath: string;
}

function buildFrontmatter(fields: {
  source_id: string;
  source_url: string;
  created_at: string;
  last_synced_at: string;
}): string {
  return [
    "---",
    "source: notion",
    `source_id: ${fields.source_id}`,
    `source_url: ${fields.source_url}`,
    `created_at: ${fields.created_at}`,
    `last_synced_at: ${fields.last_synced_at}`,
    "---",
    "",
  ].join("\n");
}

function atomicWrite(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, abs);
}

function resolveUniquePath(absDir: string, baseSlug: string, reservedFilenames: Set<string>): string {
  let candidate = `${baseSlug}.md`;
  let suffix = 2;
  while (reservedFilenames.has(candidate) || fs.existsSync(path.join(absDir, candidate))) {
    candidate = `${baseSlug}-${suffix}.md`;
    suffix += 1;
  }
  reservedFilenames.add(candidate);
  return candidate;
}

export async function runSyncNotion(deps: NotionSyncDeps): Promise<void> {
  const started = Date.now();
  const targets = getSettingJson<string[]>("notion.sync_targets") ?? [];
  if (targets.length === 0) {
    recordSyncRun({ sync_name: "sync-notion", status: "ok", duration_ms: Date.now() - started });
    return;
  }

  let cursorMap = parseCursor(readSyncCursor("sync-notion"));
  const errors: string[] = [];

  for (const db_id of targets) {
    try {
      const db = await deps.client.getDatabase(db_id);
      const dbSlug = slugify(db.title);
      const since = getDbCursor(cursorMap, db_id);
      const pages = await deps.client.queryPages(db_id, since);
      pages.sort((a, b) => (a.last_edited_time < b.last_edited_time ? -1 : 1));

      const absDir = path.join(deps.vaultPath, "notion-sync", dbSlug);
      const reservedThisRun = new Set<string>();

      let latestTimestamp = since;
      for (const page of pages) {
        const slug = slugify(page.title);
        const existing = getVaultNoteBySourceId(page.id);

        // Determine target filename (respecting collisions)
        let filename: string;
        if (existing) {
          // Preserve existing filename if title hasn't changed or slugs match
          const existingFilename = path.basename(existing.vault_path);
          const existingSlug = existingFilename.replace(/\.md$/, "");
          if (existingSlug === slug || existingSlug.startsWith(slug + "-")) {
            filename = existingFilename;
            reservedThisRun.add(filename);
          } else {
            filename = resolveUniquePath(absDir, slug, reservedThisRun);
          }
        } else {
          filename = resolveUniquePath(absDir, slug, reservedThisRun);
        }

        const newRelPath = path.posix.join("notion-sync", dbSlug, filename);
        const newAbsPath = path.join(deps.vaultPath, newRelPath);

        // If the row exists and path changed, remove the old file first
        if (existing && existing.vault_path !== newRelPath) {
          const oldAbs = path.join(deps.vaultPath, existing.vault_path);
          if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
        }

        const frontmatter = buildFrontmatter({
          source_id: page.id,
          source_url: page.url,
          created_at: existing?.created_at ?? page.last_edited_time,
          last_synced_at: nowIso(),
        });
        const fileBody = frontmatter + page.markdown + "\n";
        atomicWrite(newAbsPath, fileBody);

        const { data: fm, body } = parseFrontmatter(fileBody);
        const title = deriveTitle({ ...fm, title: page.title }, body, newRelPath);
        const contentHash = hashContent(fileBody);
        const note = upsertVaultNote({
          vault_path: newRelPath,
          title,
          source: "notion",
          source_id: page.id,
          source_url: page.url,
          content_hash: contentHash,
          modified_at: page.last_edited_time,
          created_at: existing?.created_at ?? page.last_edited_time,
        });

        // Refresh FTS for this note
        const plainText = markdownToPlainText(body);
        const inlineTags = extractInlineTags(body);
        const fmTags = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
        const tags = Array.from(new Set([...fmTags, ...inlineTags]));
        updateFtsRow({ note_id: note.id, title, plain_text: plainText, tags: tags.join(" ") });

        if (!latestTimestamp || page.last_edited_time > latestTimestamp) {
          latestTimestamp = page.last_edited_time;
        }
      }

      if (latestTimestamp && latestTimestamp !== since) {
        cursorMap = updateCursor(cursorMap, db_id, latestTimestamp);
        // Persist incrementally so a failure on a later DB doesn't lose this DB's progress
        recordSyncRun({
          sync_name: "sync-notion",
          status: "ok",
          cursor: serializeCursor(cursorMap),
        });
      }
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      errors.push(`${db_id}: ${msg}`);
      console.error(`[sync-notion] DB ${db_id} failed:`, dbErr);
      // Continue to next DB — partial progress from prior DBs is preserved in cursorMap
    }
  }

  // Final status reflects overall health; cursor may already be persisted per-DB above.
  recordSyncRun({
    sync_name: "sync-notion",
    status: errors.length > 0 ? "error" : "ok",
    duration_ms: Date.now() - started,
    cursor: serializeCursor(cursorMap),
    error_message: errors.length > 0 ? errors.join("; ").slice(0, 500) : null,
  });
}

async function main() {
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("[sync-notion] NOTION_TOKEN not set in environment");
    recordSyncRun({ sync_name: "sync-notion", status: "error", error_message: "NOTION_TOKEN missing" });
    process.exitCode = 1;
    closeDb();
    return;
  }

  const raw = new NotionClient(token);
  const client = {
    async getDatabase(id: string) {
      const db = await raw.getDatabase(id);
      return { id: db.id, title: db.title };
    },
    async queryPages(db_id: string, since?: string): Promise<SyncNotionPage[]> {
      const pages = (await raw.queryDatabase(db_id, since)) as NotionPage[];
      const out: SyncNotionPage[] = [];
      for (const p of pages) {
        const blocks = await raw.getBlocks(p.id);
        out.push({
          id: p.id,
          url: p.url,
          title: extractPageTitle(p),
          last_edited_time: p.last_edited_time,
          markdown: blocksToMarkdown(blocks),
        });
      }
      return out;
    },
  };

  try {
    await runSyncNotion({ vaultPath, client });
    console.log("[sync-notion] ok");
  } catch (err) {
    console.error("[sync-notion] error:", err);
    recordSyncRun({
      sync_name: "sync-notion",
      status: "error",
      error_message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
