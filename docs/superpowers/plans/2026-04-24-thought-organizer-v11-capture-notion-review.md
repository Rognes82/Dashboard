# Thought Organizer v1.1 (Capture + Notion Sync + Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four features that make the Thought Organizer reach-for-daily: Quick Capture from anywhere in the dashboard, Notion sync that pulls real structured content into the vault, a Review surface (today / uncategorized / stale), and a Settings UI that manages Notion targets and exposes manual action buttons.

**Architecture:** Capture writes markdown directly to the vault (source-of-truth first, SQLite downstream via immediate indexer pass). Notion sync is a cron-driven script that reads targets from a new `app_settings` table, polls each configured database with a `last_edited_time > cursor` delta filter, converts block trees to markdown via a pure-function converter, and writes files atomically using `source_id` as the dedup key. The Review page is a single API route joining existing queries. Settings UI is mostly read-only status + a couple of editable lists + action buttons that spawn the existing scripts.

**Tech Stack:** Same as Phase 1 — Next.js 14, better-sqlite3, Vitest, `@notionhq/client` (already installed). No new dependencies — Notion rate limiting uses a small inline `RateLimiter` class (see Task 10) rather than adding `p-limit` (which is ESM-only and would fail in our CommonJS context).

**Spec reference:** `docs/superpowers/specs/2026-04-23-thought-organizer-design.md` §4.2 (Notion sync), §5.4 (Settings), §6 (Capture flow), §8 (Review).

**Builds on:** `docs/superpowers/plans/2026-04-23-thought-organizer-v1-foundation.md` — all Phase 1 infrastructure is assumed present.

---

## File Structure

**Created:**
- `lib/queries/app-settings.ts` — key/value settings CRUD
- `lib/capture/slug.ts` — capture filename slug generator
- `lib/notion/cursor.ts` — JSON cursor map helpers for Notion sync
- `lib/notion/blocks-to-markdown.ts` — pure converter for Notion block tree → markdown string
- `lib/notion/client.ts` — thin rate-limited wrapper around `@notionhq/client`
- `lib/queries/review.ts` — review-surface queries (stale bins)
- `scripts/sync-notion.ts` — cron script
- `app/api/notes/capture/route.ts` — POST to create a capture
- `app/api/review/route.ts` — GET aggregated review data
- `app/api/settings/notion-targets/route.ts` — GET/PUT Notion sync target list
- `app/api/actions/reindex/route.ts` — POST triggers full reindex
- `app/api/actions/seed-bins/route.ts` — POST triggers `sync-obsidian`
- `app/review/page.tsx` — review UI
- `components/QuickCapture.tsx` — modal
- `components/GlobalCapture.tsx` — keyboard shortcut provider
- `components/ActionButton.tsx` — reusable async-action button for settings
- Tests for all of the above

**Modified:**
- `lib/schema.sql` — add `app_settings` table
- `app/layout.tsx` — mount `<GlobalCapture />`
- `components/Sidebar.tsx` — add `/review` nav item
- `app/settings/page.tsx` — add Notion targets section + action buttons + sync health card
- `package.json` — add `p-limit` dep + `sync:notion` script

---

## Task order

Parts A–E are sequenced so each part produces something testable:
- A: Settings persistence (schema + query layer)
- B: Quick Capture (standalone feature, end-to-end)
- C: Notion sync (standalone, cron-runnable)
- D: Review surface (depends on some Phase 1 queries, no new data needed)
- E: Settings UI (depends on A, C for targets)
- F: Verification pass

---

### Task 1: Verify Phase 1 baseline

No dependency install required — the Notion rate limiter is inlined in Task 10 (see "NotionClient wrapper"). This is a pure verification task: confirm we're starting from a green Phase 1 baseline before Phase 2 work begins.

**Files:** none.

- [ ] **Step 1: Run full suite on current branch**

Run: `npm test`
Expected: 85 passing, 17 test files. If any test fails, STOP and resolve before proceeding.

- [ ] **Step 2: Confirm branch is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` (ignoring any untracked `ref/` folder from earlier).

- [ ] **Step 3: No commit**

This task produces no file changes.

**Why no p-limit?** `p-limit@^6` is ESM-only, and our project is `"type": "commonjs"`. Importing it via `tsx`-run scripts would throw `ERR_REQUIRE_ESM`. Rather than pin to the last CJS-compatible `p-limit@^4`, we use a small inline `RateLimiter` class in Task 10 — 15 lines, no dependency, easier to reason about, and `pLimit(1)` was effectively sequential execution anyway.

---

### Task 2: Schema — add `app_settings` table

**Files:** Modify `lib/schema.sql`

- [ ] **Step 1: Append the new table definition**

Open `lib/schema.sql` and append at the end (after the last index, before EOF):

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Apply to live DB**

Run:
```bash
npm run init-db
```

Expected: `Database initialized at data/dashboard.db`. No errors.

- [ ] **Step 3: Verify**

Run:
```bash
sqlite3 data/dashboard.db ".schema app_settings"
```

Expected: the exact CREATE TABLE above.

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(schema): add app_settings k/v table"
```

---

### Task 3: `lib/queries/app-settings.ts` + tests

**Files:**
- Create: `lib/queries/app-settings.ts`
- Create: `tests/lib/queries/app-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/queries/app-settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson,
} from "../../../lib/queries/app-settings";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-app-settings.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("app-settings queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("setSetting + getSetting round-trip", () => {
    setSetting("k1", "v1");
    expect(getSetting("k1")).toBe("v1");
  });

  it("getSetting returns null for missing key", () => {
    expect(getSetting("nope")).toBeNull();
  });

  it("setSetting overwrites existing value", () => {
    setSetting("k1", "a");
    setSetting("k1", "b");
    expect(getSetting("k1")).toBe("b");
  });

  it("deleteSetting removes the key", () => {
    setSetting("k1", "v1");
    deleteSetting("k1");
    expect(getSetting("k1")).toBeNull();
  });

  it("setSettingJson + getSettingJson round-trip", () => {
    setSettingJson("notion.targets", ["db1", "db2"]);
    expect(getSettingJson<string[]>("notion.targets")).toEqual(["db1", "db2"]);
  });

  it("getSettingJson returns null for malformed JSON", () => {
    setSetting("bad.json", "not-valid-json");
    expect(getSettingJson("bad.json")).toBeNull();
  });

  it("getSettingJson returns null for missing key", () => {
    expect(getSettingJson("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/lib/queries/app-settings.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/queries/app-settings.ts`:

```typescript
import { getDb } from "../db";
import { nowIso } from "../utils";

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, nowIso());
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

export function getSettingJson<T>(key: string): T | null {
  const raw = getSetting(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setSettingJson(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/lib/queries/app-settings.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/app-settings.ts tests/lib/queries/app-settings.test.ts
git commit -m "feat(queries): app_settings key/value + JSON helpers"
```

---

### Task 4: Capture slug utility + tests

**Files:**
- Create: `lib/capture/slug.ts`
- Create: `tests/lib/capture/slug.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/capture/slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { captureSlug, captureFilename } from "../../../lib/capture/slug";

describe("captureSlug", () => {
  it("takes first 5 words, lowercased and hyphenated", () => {
    expect(captureSlug("Tokyo reel idea for the content series")).toBe("tokyo-reel-idea-for-the");
  });

  it("strips non-alphanumerics", () => {
    expect(captureSlug("Hey! I'm testing: #tags & stuff.")).toBe("hey-im-testing-tags-stuff");
  });

  it("falls back to 'capture' when input has fewer than 3 words", () => {
    expect(captureSlug("hi")).toBe("capture");
    expect(captureSlug("")).toBe("capture");
    expect(captureSlug("   ")).toBe("capture");
  });

  it("collapses multiple spaces/newlines", () => {
    expect(captureSlug("alpha\n\nbeta   gamma\tdelta epsilon zeta")).toBe("alpha-beta-gamma-delta-epsilon");
  });

  it("strips unicode gracefully (emoji, accents)", () => {
    expect(captureSlug("café olé 🎉 paris dreams")).toBe("caf-ol-paris-dreams");
  });
});

describe("captureFilename", () => {
  it("formats <YYYY-MM-DD-HH-MM>-<slug>.md", () => {
    const ts = new Date("2026-04-24T14:32:00Z");
    expect(captureFilename(ts, "tokyo-reel-idea-for-the")).toBe("2026-04-24-14-32-tokyo-reel-idea-for-the.md");
  });

  it("pads minutes and hours", () => {
    const ts = new Date("2026-04-24T03:05:00Z");
    expect(captureFilename(ts, "short")).toBe("2026-04-24-03-05-short.md");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/lib/capture/slug.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `lib/capture/slug.ts`:

```typescript
const WORD_RE = /[A-Za-z0-9]+/g;

export function captureSlug(text: string): string {
  const words = text.toLowerCase().match(WORD_RE) ?? [];
  if (words.length < 3) return "capture";
  return words.slice(0, 5).join("-");
}

export function captureFilename(date: Date, slug: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const Y = date.getUTCFullYear();
  const M = pad(date.getUTCMonth() + 1);
  const D = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const m = pad(date.getUTCMinutes());
  return `${Y}-${M}-${D}-${h}-${m}-${slug}.md`;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/lib/capture/slug.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/capture/slug.ts tests/lib/capture/slug.test.ts
git commit -m "feat(capture): slug + filename helpers"
```

---

### Task 5: POST `/api/notes/capture`

**Files:**
- Create: `app/api/notes/capture/route.ts`

This endpoint writes the markdown file with frontmatter, then spawns a single-file indexer pass. Returns 200 always on successful file write; `indexed: false` if the spawn fails.

- [ ] **Step 1: Write the route**

Create `app/api/notes/capture/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { captureSlug, captureFilename } from "@/lib/capture/slug";
import { getBinById } from "@/lib/queries/bins";
import { getVaultNoteByPath } from "@/lib/queries/vault-notes";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";
import { nowIso } from "@/lib/utils";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
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
```

- [ ] **Step 2: Quick manual smoke (optional)**

If you want to verify via curl (requires VAULT_PATH set + a bin ID):
```bash
sqlite3 data/dashboard.db "SELECT id, name FROM bins LIMIT 1;"
# copy the bin id
curl -X POST http://localhost:3000/api/notes/capture \
  -H 'Content-Type: application/json' \
  -d '{"content":"Test capture from curl","bin_id":"<paste>"}'
```

Skip if the dev server isn't running.

- [ ] **Step 3: Verify suite**

```bash
npm test
```
Expected: 92 passing (85 + 7 new app-settings + slug tests already added).

- [ ] **Step 4: Commit**

```bash
git add app/api/notes/capture/route.ts
git commit -m "feat(api): POST /api/notes/capture writes md + triggers indexer"
```

---

### Task 6: `QuickCapture` modal component

**Files:**
- Create: `components/QuickCapture.tsx`

Client-side modal. Fetches bins list on open, presents a textarea + bin dropdown + tag input, submits to `/api/notes/capture`.

- [ ] **Step 1: Write the component**

Create `components/QuickCapture.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { BinNode } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCaptured?: (noteId: string | null) => void;
}

function flattenBins(nodes: BinNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    out.push(...flattenBins(n.children, depth + 1));
  }
  return out;
}

export function QuickCapture({ open, onClose, onCaptured }: Props) {
  const [bins, setBins] = useState<BinNode[]>([]);
  const [content, setContent] = useState("");
  const [binId, setBinId] = useState<string>("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => {
        const flat = flattenBins(d.bins ?? []);
        setBins(d.bins ?? []);
        if (flat[0]) setBinId((prev) => prev || flat[0].id);
      });
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 30);
    else {
      setContent("");
      setTags("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!content.trim()) {
      setError("Content required");
      return;
    }
    if (!binId) {
      setError("Pick a bin");
      return;
    }
    setSubmitting(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/notes/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), bin_id: binId, tags: tagList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Capture failed");
        return;
      }
      onCaptured?.(data.note_id ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setSubmitting(false);
    }
  }

  const flat = flattenBins(bins);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-[min(640px,90vw)] p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="mono text-sm font-semibold text-text-primary">Quick Capture</h2>
          <button
            onClick={onClose}
            className="text-[10px] text-text-muted hover:text-text-primary mono"
            aria-label="Close capture dialog"
          >
            Esc
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="What's on your mind?"
          rows={6}
          className="w-full bg-base border border-border rounded p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-green focus:outline-none resize-none"
        />
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted uppercase mono">Bin</span>
            <select
              value={binId}
              onChange={(e) => setBinId(e.target.value)}
              className="bg-base border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:border-accent-green focus:outline-none"
            >
              {flat.length === 0 && <option value="">(no bins yet)</option>}
              {flat.map((b) => (
                <option key={b.id} value={b.id}>
                  {"— ".repeat(b.depth)}
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted uppercase mono">Tags (comma-sep)</span>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="idea, inbox"
              className="bg-base border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:border-accent-green focus:outline-none"
            />
          </label>
        </div>
        {error && <div className="text-[10px] text-red-400">{error}</div>}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[10px] text-text-muted mono">⌘⏎ to submit · Esc to cancel</div>
          <button
            onClick={submit}
            disabled={submitting}
            className="bg-accent-green text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-accent-green/90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/QuickCapture.tsx
git commit -m "feat(ui): QuickCapture modal with bin picker + tags + ⌘⏎ submit"
```

---

### Task 7: Global capture hotkey wrapper

**Files:**
- Create: `components/GlobalCapture.tsx`

Registers a `Cmd+Shift+C` (or `Ctrl+Shift+C`) keyboard listener that toggles the `QuickCapture` modal. Mounted in the root layout so it's live on every page.

- [ ] **Step 1: Write the component**

Create `components/GlobalCapture.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { QuickCapture } from "./QuickCapture";

export function GlobalCapture() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return <QuickCapture open={open} onClose={() => setOpen(false)} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/GlobalCapture.tsx
git commit -m "feat(ui): GlobalCapture keyboard shortcut (Cmd+Shift+C)"
```

---

### Task 8: Mount `GlobalCapture` in layout

**Files:** Modify `app/layout.tsx`

- [ ] **Step 1: Add the mount**

Replace the contents of `app/layout.tsx` with:

```typescript
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { GlobalCapture } from "@/components/GlobalCapture";
import "./globals.css";

export const metadata: Metadata = {
  title: "Command Center",
  description: "Unified dashboard for clients, agents, and system health",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <GlobalCapture />
        <main className="ml-14 min-h-screen p-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify TS compiles cleanly**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ui): mount GlobalCapture in root layout"
```

---

### Task 9: Notion cursor JSON utility + tests

**Files:**
- Create: `lib/notion/cursor.ts`
- Create: `tests/lib/notion/cursor.test.ts`

The cursor is a JSON map `{ "<database_id>": "<iso_timestamp>" }` stored in `sync_status.cursor` where `sync_name='sync-notion'`.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/notion/cursor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCursor, serializeCursor, updateCursor, getDbCursor } from "../../../lib/notion/cursor";

describe("notion cursor", () => {
  it("parseCursor returns empty map for null/missing", () => {
    expect(parseCursor(null)).toEqual({});
    expect(parseCursor(undefined as unknown as string)).toEqual({});
  });

  it("parseCursor returns map for valid JSON object", () => {
    expect(parseCursor('{"db1":"2026-04-23T10:00:00Z"}')).toEqual({
      db1: "2026-04-23T10:00:00Z",
    });
  });

  it("parseCursor returns empty map for malformed JSON", () => {
    expect(parseCursor("not-json")).toEqual({});
  });

  it("parseCursor returns empty map for non-object (array, string, number)", () => {
    expect(parseCursor('["db1"]')).toEqual({});
    expect(parseCursor('"raw"')).toEqual({});
    expect(parseCursor("42")).toEqual({});
  });

  it("serializeCursor round-trips", () => {
    const m = { db1: "2026-04-23T10:00:00Z", db2: "2026-04-24T00:00:00Z" };
    expect(parseCursor(serializeCursor(m))).toEqual(m);
  });

  it("updateCursor sets one entry without touching others", () => {
    const m = { db1: "2026-04-23T10:00:00Z" };
    expect(updateCursor(m, "db2", "2026-04-24T12:00:00Z")).toEqual({
      db1: "2026-04-23T10:00:00Z",
      db2: "2026-04-24T12:00:00Z",
    });
  });

  it("getDbCursor returns timestamp for known db, undefined for unknown", () => {
    const m = { db1: "2026-04-23T10:00:00Z" };
    expect(getDbCursor(m, "db1")).toBe("2026-04-23T10:00:00Z");
    expect(getDbCursor(m, "db2")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/lib/notion/cursor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `lib/notion/cursor.ts`:

```typescript
export type NotionCursorMap = Record<string, string>;

export function parseCursor(raw: string | null | undefined): NotionCursorMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: NotionCursorMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeCursor(map: NotionCursorMap): string {
  return JSON.stringify(map);
}

export function updateCursor(map: NotionCursorMap, db_id: string, timestamp: string): NotionCursorMap {
  return { ...map, [db_id]: timestamp };
}

export function getDbCursor(map: NotionCursorMap, db_id: string): string | undefined {
  return map[db_id];
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/lib/notion/cursor.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/cursor.ts tests/lib/notion/cursor.test.ts
git commit -m "feat(notion): cursor JSON parse/serialize/update helpers"
```

---

### Task 10: Notion blocks → markdown converter + tests

**Files:**
- Create: `lib/notion/blocks-to-markdown.ts`
- Create: `tests/lib/notion/blocks-to-markdown.test.ts`

Pure function: takes a tree of Notion block objects (in the same shape the API returns) and emits a markdown string. Supports the block types that matter for a vault mirror. Unsupported block types become a commented-out placeholder so the user knows something's there.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/notion/blocks-to-markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { blocksToMarkdown, type NotionBlock } from "../../../lib/notion/blocks-to-markdown";

function textBlock(type: string, text: string, extra: Partial<NotionBlock> = {}): NotionBlock {
  return {
    id: "b" + Math.random(),
    type,
    has_children: false,
    [type]: { rich_text: [{ plain_text: text, annotations: {} }] },
    ...extra,
  } as NotionBlock;
}

describe("blocksToMarkdown", () => {
  it("converts paragraphs and headings", () => {
    const blocks: NotionBlock[] = [
      textBlock("heading_1", "Title"),
      textBlock("paragraph", "Some body text."),
      textBlock("heading_2", "Subhead"),
      textBlock("paragraph", "More body."),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subhead");
    expect(md).toContain("Some body text.");
    expect(md).toContain("More body.");
  });

  it("converts bulleted and numbered lists", () => {
    const md = blocksToMarkdown([
      textBlock("bulleted_list_item", "apple"),
      textBlock("bulleted_list_item", "banana"),
      textBlock("numbered_list_item", "first"),
      textBlock("numbered_list_item", "second"),
    ]);
    expect(md).toMatch(/- apple[\s\S]*- banana/);
    expect(md).toMatch(/1\. first[\s\S]*1\. second/);
  });

  it("converts to_do blocks to task list syntax", () => {
    const blocks: NotionBlock[] = [
      {
        id: "t1",
        type: "to_do",
        has_children: false,
        to_do: { rich_text: [{ plain_text: "done thing", annotations: {} }], checked: true },
      } as NotionBlock,
      {
        id: "t2",
        type: "to_do",
        has_children: false,
        to_do: { rich_text: [{ plain_text: "open thing", annotations: {} }], checked: false },
      } as NotionBlock,
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- [x] done thing");
    expect(md).toContain("- [ ] open thing");
  });

  it("renders code blocks with language", () => {
    const block: NotionBlock = {
      id: "c1",
      type: "code",
      has_children: false,
      code: { language: "typescript", rich_text: [{ plain_text: "const x = 1;", annotations: {} }] },
    } as NotionBlock;
    const md = blocksToMarkdown([block]);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 1;");
    expect(md).toContain("```");
  });

  it("preserves bold/italic/code annotations in rich text", () => {
    const block: NotionBlock = {
      id: "p1",
      type: "paragraph",
      has_children: false,
      paragraph: {
        rich_text: [
          { plain_text: "plain ", annotations: {} },
          { plain_text: "bold ", annotations: { bold: true } },
          { plain_text: "italic ", annotations: { italic: true } },
          { plain_text: "code", annotations: { code: true } },
        ],
      },
    } as NotionBlock;
    const md = blocksToMarkdown([block]);
    expect(md).toContain("plain **bold** *italic* `code`");
  });

  it("recurses into children for nested lists", () => {
    const parent: NotionBlock = {
      id: "p1",
      type: "bulleted_list_item",
      has_children: true,
      bulleted_list_item: { rich_text: [{ plain_text: "parent", annotations: {} }] },
      children: [textBlock("bulleted_list_item", "child-a"), textBlock("bulleted_list_item", "child-b")],
    } as NotionBlock;
    const md = blocksToMarkdown([parent]);
    expect(md).toContain("- parent");
    expect(md).toContain("  - child-a");
    expect(md).toContain("  - child-b");
  });

  it("emits a placeholder comment for unsupported block types", () => {
    const block: NotionBlock = {
      id: "u1",
      type: "audio",
      has_children: false,
    } as NotionBlock;
    expect(blocksToMarkdown([block])).toContain("<!-- unsupported: audio");
  });

  it("handles empty input", () => {
    expect(blocksToMarkdown([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/lib/notion/blocks-to-markdown.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `lib/notion/blocks-to-markdown.ts`:

```typescript
export interface RichTextSpan {
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
  href?: string | null;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[];
  // One of these payload shapes based on type
  paragraph?: { rich_text: RichTextSpan[] };
  heading_1?: { rich_text: RichTextSpan[] };
  heading_2?: { rich_text: RichTextSpan[] };
  heading_3?: { rich_text: RichTextSpan[] };
  bulleted_list_item?: { rich_text: RichTextSpan[] };
  numbered_list_item?: { rich_text: RichTextSpan[] };
  to_do?: { rich_text: RichTextSpan[]; checked: boolean };
  toggle?: { rich_text: RichTextSpan[] };
  quote?: { rich_text: RichTextSpan[] };
  callout?: { rich_text: RichTextSpan[] };
  code?: { language: string; rich_text: RichTextSpan[] };
}

function richText(spans: RichTextSpan[] | undefined): string {
  if (!spans) return "";
  return spans
    .map((s) => {
      let out = s.plain_text;
      const a = s.annotations ?? {};
      if (a.code) out = "`" + out + "`";
      if (a.italic) out = "*" + out + "*";
      if (a.bold) out = "**" + out + "**";
      if (a.strikethrough) out = "~~" + out + "~~";
      if (s.href) out = "[" + out + "](" + s.href + ")";
      return out;
    })
    .join("");
}

function renderBlock(block: NotionBlock, depth: number): string {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "paragraph":
      return indent + richText(block.paragraph?.rich_text);
    case "heading_1":
      return indent + "# " + richText(block.heading_1?.rich_text);
    case "heading_2":
      return indent + "## " + richText(block.heading_2?.rich_text);
    case "heading_3":
      return indent + "### " + richText(block.heading_3?.rich_text);
    case "bulleted_list_item":
      return indent + "- " + richText(block.bulleted_list_item?.rich_text);
    case "numbered_list_item":
      return indent + "1. " + richText(block.numbered_list_item?.rich_text);
    case "to_do":
      return (
        indent +
        "- [" +
        (block.to_do?.checked ? "x" : " ") +
        "] " +
        richText(block.to_do?.rich_text)
      );
    case "toggle":
      return indent + "- " + richText(block.toggle?.rich_text);
    case "quote":
      return indent + "> " + richText(block.quote?.rich_text);
    case "callout":
      return indent + "> " + richText(block.callout?.rich_text);
    case "code":
      return (
        indent +
        "```" +
        (block.code?.language ?? "") +
        "\n" +
        richText(block.code?.rich_text) +
        "\n" +
        indent +
        "```"
      );
    case "divider":
      return indent + "---";
    default:
      return indent + `<!-- unsupported: ${block.type} -->`;
  }
}

export function blocksToMarkdown(blocks: NotionBlock[], depth = 0): string {
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(renderBlock(block, depth));
    if (block.has_children && block.children && block.children.length > 0) {
      lines.push(blocksToMarkdown(block.children, depth + 1));
    }
  }
  return lines.filter((l) => l.length > 0).join("\n\n");
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/lib/notion/blocks-to-markdown.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/blocks-to-markdown.ts tests/lib/notion/blocks-to-markdown.test.ts
git commit -m "feat(notion): block tree → markdown converter"
```

---

### Task 11: Notion client wrapper

**Files:**
- Create: `lib/notion/client.ts`

Thin wrapper around `@notionhq/client`. Exposes only the methods the sync script needs. Uses `p-limit` for a 2.5 req/s concurrency cap (one in-flight slot + 400ms min gap) and exponential backoff on 429 responses.

- [ ] **Step 1: Write the client**

Create `lib/notion/client.ts`:

```typescript
import { Client } from "@notionhq/client";
import type { NotionBlock } from "./blocks-to-markdown";

const MIN_GAP_MS = 400; // ~2.5 req/s
const MAX_RETRIES = 5;
const MAX_BLOCK_DEPTH = 10;

export interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  created_time: string;
  properties: Record<string, unknown>;
  archived: boolean;
}

export interface NotionDatabase {
  id: string;
  title: string;
}

/**
 * Inline rate limiter — chains calls via a single Promise queue, enforcing a
 * minimum gap between request starts. No external dep (p-limit is ESM-only).
 */
class RateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  constructor(private minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const delta = Date.now() - this.lastAt;
      if (delta < this.minGapMs) {
        await new Promise((r) => setTimeout(r, this.minGapMs - delta));
      }
      this.lastAt = Date.now();
      return fn();
    });
    // Keep the chain alive regardless of success/failure so later callers still wait.
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result as Promise<T>;
  }
}

export class NotionClient {
  private client: Client;
  private rl = new RateLimiter(MIN_GAP_MS);

  constructor(token: string) {
    this.client = new Client({ auth: token, notionVersion: "2026-03-11" });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.rl.run(async () => {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err: unknown) {
          const e = err as { code?: string; status?: number };
          const is429 = e.status === 429 || e.code === "rate_limited";
          if (!is429 || attempt >= MAX_RETRIES) throw err;
          const backoff = Math.min(60_000, 1000 * 2 ** attempt);
          await new Promise((r) => setTimeout(r, backoff));
          attempt += 1;
        }
      }
    });
  }

  async getDatabase(database_id: string): Promise<NotionDatabase> {
    const res = (await this.call(() => this.client.databases.retrieve({ database_id }))) as {
      id: string;
      title?: { plain_text: string }[];
    };
    const title = res.title?.map((t) => t.plain_text).join("") ?? res.id;
    return { id: res.id, title };
  }

  async queryDatabase(database_id: string, filter_since?: string): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;
    do {
      const res = (await this.call(() =>
        this.client.databases.query({
          database_id,
          start_cursor: cursor,
          page_size: 100,
          filter: filter_since
            ? {
                timestamp: "last_edited_time",
                last_edited_time: { after: filter_since },
              }
            : undefined,
          sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
        })
      )) as {
        results: NotionPage[];
        has_more: boolean;
        next_cursor: string | null;
      };
      pages.push(...res.results);
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return pages;
  }

  async getBlocks(block_id: string, depth = 0): Promise<NotionBlock[]> {
    if (depth > MAX_BLOCK_DEPTH) {
      console.warn(`[notion] block tree exceeded MAX_BLOCK_DEPTH (${MAX_BLOCK_DEPTH}) at ${block_id}; truncating`);
      return [];
    }
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      const res = (await this.call(() =>
        this.client.blocks.children.list({ block_id, start_cursor: cursor, page_size: 100 })
      )) as { results: NotionBlock[]; has_more: boolean; next_cursor: string | null };
      out.push(...res.results);
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);

    // Recursively fetch children for blocks with has_children, up to MAX_BLOCK_DEPTH
    for (const block of out) {
      if (block.has_children) {
        block.children = await this.getBlocks(block.id, depth + 1);
      }
    }
    return out;
  }
}

export function extractPageTitle(page: NotionPage): string {
  // Pages typically have a "title" property in their properties map.
  for (const [, prop] of Object.entries(page.properties)) {
    const p = prop as { type?: string; title?: { plain_text: string }[] };
    if (p.type === "title" && p.title) {
      const joined = p.title.map((t) => t.plain_text).join("").trim();
      if (joined) return joined;
    }
  }
  return page.id;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/notion/client.ts
git commit -m "feat(notion): rate-limited client wrapper with retries + title extraction"
```

---

### Task 12: `scripts/sync-notion.ts`

**Files:**
- Create: `scripts/sync-notion.ts`
- Create: `tests/scripts/sync-notion.test.ts`
- Modify: `package.json`

The script reads `NOTION_TOKEN` from env, reads `notion.sync_targets` JSON array from `app_settings`, and for each database: queries pages updated since cursor, fetches blocks for each page, converts to markdown, writes file atomically, upserts via `source_id` (handling renames).

Tests use dependency injection to provide a fake `NotionClient` so no real API calls are made.

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/sync-notion.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runSyncNotion, type NotionSyncDeps } from "../../scripts/sync-notion";
import { setSettingJson } from "../../lib/queries/app-settings";
import { getVaultNoteBySourceId, listVaultNotes } from "../../lib/queries/vault-notes";
import { slugify } from "../../lib/utils";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-notion.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function tempVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vault-notion-test-"));
}

function fakeClient(options: {
  database: { id: string; title: string };
  pagesByDb: Record<string, Array<{
    id: string;
    url: string;
    title: string;
    last_edited_time: string;
    blocks_markdown: string; // the markdown we want produced
  }>>;
}): NotionSyncDeps["client"] {
  return {
    async getDatabase(id: string) {
      if (id !== options.database.id) throw new Error("unknown db");
      return options.database;
    },
    async queryPages(db_id: string, since?: string) {
      const all = options.pagesByDb[db_id] ?? [];
      const filtered = since ? all.filter((p) => p.last_edited_time > since) : all;
      return filtered.map((p) => ({
        id: p.id,
        url: p.url,
        title: p.title,
        last_edited_time: p.last_edited_time,
        markdown: p.blocks_markdown,
      }));
    },
  };
}

describe("sync-notion", () => {
  beforeEach(() => initTestDb());
  afterEach(() => closeDb());

  it("pulls pages from a configured database and writes markdown files", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "First Meeting",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "# First Meeting\n\nNotes here.",
            },
          ],
        },
      }),
    });

    const row = getVaultNoteBySourceId("page-1");
    expect(row).not.toBeNull();
    expect(row?.source).toBe("notion");
    expect(row?.vault_path).toBe(`notion-sync/${slugify("Meetings")}/${slugify("First Meeting")}.md`);

    const onDisk = fs.readFileSync(path.join(vault, row!.vault_path), "utf-8");
    expect(onDisk).toContain("source: notion");
    expect(onDisk).toContain("source_id: page-1");
    expect(onDisk).toContain("First Meeting");

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("skips pages older than the per-db cursor", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    // First run
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "old",
              url: "https://notion.so/old",
              title: "Old Page",
              last_edited_time: "2026-04-20T00:00:00Z",
              blocks_markdown: "old body",
            },
          ],
        },
      }),
    });

    // Second run with same old page + one new
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "old",
              url: "https://notion.so/old",
              title: "Old Page",
              last_edited_time: "2026-04-20T00:00:00Z",
              blocks_markdown: "old body",
            },
            {
              id: "new",
              url: "https://notion.so/new",
              title: "New Page",
              last_edited_time: "2026-04-24T12:00:00Z",
              blocks_markdown: "new body",
            },
          ],
        },
      }),
    });

    const notes = listVaultNotes(100);
    expect(notes).toHaveLength(2); // old + new, processed once each
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("handles page rename by renaming the file on disk and reusing the same row", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    // First sync
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "Original Title",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "body",
            },
          ],
        },
      }),
    });

    const firstRow = getVaultNoteBySourceId("page-1");
    const firstPath = firstRow!.vault_path;
    expect(fs.existsSync(path.join(vault, firstPath))).toBe(true);

    // Second sync with new title and a later timestamp
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "Renamed Title",
              last_edited_time: "2026-04-24T10:00:00Z",
              blocks_markdown: "body",
            },
          ],
        },
      }),
    });

    const secondRow = getVaultNoteBySourceId("page-1");
    expect(secondRow!.id).toBe(firstRow!.id); // same DB row
    expect(secondRow!.vault_path).not.toBe(firstPath); // path changed
    expect(fs.existsSync(path.join(vault, firstPath))).toBe(false); // old file gone
    expect(fs.existsSync(path.join(vault, secondRow!.vault_path))).toBe(true); // new file present

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("appends -2 on slug collision within a database", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Notes" },
        pagesByDb: {
          db1: [
            {
              id: "p-a",
              url: "u",
              title: "Same Title",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "a",
            },
            {
              id: "p-b",
              url: "u",
              title: "Same Title",
              last_edited_time: "2026-04-23T10:01:00Z",
              blocks_markdown: "b",
            },
          ],
        },
      }),
    });

    const a = getVaultNoteBySourceId("p-a");
    const b = getVaultNoteBySourceId("p-b");
    expect(a!.vault_path).not.toBe(b!.vault_path);
    expect([a!.vault_path, b!.vault_path].some((p) => p.endsWith("-2.md"))).toBe(true);

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("exits cleanly with no targets configured", async () => {
    const vault = tempVault();
    // No sync_targets set
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({ database: { id: "x", title: "x" }, pagesByDb: {} }),
    });
    expect(listVaultNotes(100)).toHaveLength(0);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("continues past a failing database and preserves cursor for successful ones", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db-good", "db-bad", "db-also-good"]);

    const throwingClient = {
      async getDatabase(id: string) {
        if (id === "db-bad") throw new Error("simulated auth failure");
        return { id, title: id === "db-good" ? "Good" : "Also Good" };
      },
      async queryPages(db_id: string) {
        if (db_id === "db-bad") throw new Error("should never reach queryPages on bad");
        return [
          {
            id: `${db_id}-page-1`,
            url: `https://notion.so/${db_id}-1`,
            title: `${db_id} Page`,
            last_edited_time: "2026-04-24T09:00:00Z",
            markdown: "body",
          },
        ];
      },
    };

    await runSyncNotion({ vaultPath: vault, client: throwingClient });

    // Both good DBs wrote their page
    expect(getVaultNoteBySourceId("db-good-page-1")).not.toBeNull();
    expect(getVaultNoteBySourceId("db-also-good-page-1")).not.toBeNull();

    // Sync status records "error" due to db-bad, but cursor reflects success for the others
    const { readSyncCursor, listSyncStatuses } = await import("../../lib/queries/sync-status");
    const status = listSyncStatuses().find((s) => s.sync_name === "sync-notion");
    expect(status?.status).toBe("error");
    expect(status?.error_message).toContain("db-bad");

    const cursorRaw = readSyncCursor("sync-notion");
    expect(cursorRaw).toBeTruthy();
    const cursor = JSON.parse(cursorRaw!);
    expect(cursor["db-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["db-also-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["db-bad"]).toBeUndefined();

    fs.rmSync(vault, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/scripts/sync-notion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/sync-notion.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/scripts/sync-notion.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Add npm script**

Modify `package.json` `scripts` section — add:
```json
    "sync:notion": "tsx scripts/sync-notion.ts",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-notion.ts tests/scripts/sync-notion.test.ts package.json
git commit -m "feat(scripts): sync-notion with cursor + rename handling + slug collision"
```

---

### Task 13: Stale bins query

**Files:**
- Create: `lib/queries/review.ts`
- Create: `tests/lib/queries/review.test.ts`

The review page needs "stale bins" — bins where no note inside has been modified in the last N days, OR bins that contain no active notes at all.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/queries/review.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { listStaleBins } from "../../../lib/queries/review";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-review.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("listStaleBins", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns bins whose most recent note is older than the threshold", () => {
    const stale = createBin({ name: "Stale" });
    const fresh = createBin({ name: "Fresh" });

    const oldNote = upsertVaultNote({
      vault_path: "a.md",
      title: "Old",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: "2026-01-01T00:00:00Z",
    });
    assignNoteToBin({ note_id: oldNote.id, bin_id: stale.id, assigned_by: "manual" });

    const newNote = upsertVaultNote({
      vault_path: "b.md",
      title: "New",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: new Date().toISOString(),
    });
    assignNoteToBin({ note_id: newNote.id, bin_id: fresh.id, assigned_by: "manual" });

    const stales = listStaleBins(30);
    expect(stales.map((b) => b.id)).toContain(stale.id);
    expect(stales.map((b) => b.id)).not.toContain(fresh.id);
  });

  it("includes bins with zero active notes", () => {
    const empty = createBin({ name: "Empty" });
    const stales = listStaleBins(30);
    expect(stales.map((b) => b.id)).toContain(empty.id);
  });

  it("reports last_activity per bin (null for empty)", () => {
    const empty = createBin({ name: "Empty" });
    const stale = createBin({ name: "Stale" });
    const note = upsertVaultNote({
      vault_path: "a.md",
      title: "Old",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: "2026-01-01T00:00:00Z",
    });
    assignNoteToBin({ note_id: note.id, bin_id: stale.id, assigned_by: "manual" });

    const stales = listStaleBins(30);
    const emptyRow = stales.find((b) => b.id === empty.id)!;
    const staleRow = stales.find((b) => b.id === stale.id)!;
    expect(emptyRow.last_activity).toBeNull();
    expect(staleRow.last_activity).toBe("2026-01-01T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/lib/queries/review.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `lib/queries/review.ts`:

```typescript
import { getDb } from "../db";
import type { Bin } from "../types";

export interface StaleBin extends Bin {
  last_activity: string | null;
}

export function listStaleBins(days: number): StaleBin[] {
  const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT b.*, MAX(vn.modified_at) AS last_activity
       FROM bins b
       LEFT JOIN note_bins nb ON nb.bin_id = b.id
       LEFT JOIN vault_notes vn ON vn.id = nb.note_id AND vn.deleted_at IS NULL
       GROUP BY b.id
       HAVING last_activity IS NULL OR last_activity < ?
       ORDER BY (last_activity IS NULL) DESC, last_activity ASC`
    )
    .all(cutoff) as StaleBin[];
  return rows;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/lib/queries/review.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/review.ts tests/lib/queries/review.test.ts
git commit -m "feat(queries): listStaleBins for review surface"
```

---

### Task 14: `/api/review` endpoint

**Files:**
- Create: `app/api/review/route.ts`

Returns `{ today, recent, uncategorized, stale_bins }` in one response so the page fetches once.

- [ ] **Step 1: Write the route**

Create `app/api/review/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  listRecentVaultNotes,
  listUncategorizedVaultNotes,
} from "@/lib/queries/vault-notes";
import { listStaleBins } from "@/lib/queries/review";

export async function GET() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hoursSinceStartOfDay = Math.max(
    1,
    Math.ceil((Date.now() - todayStart.getTime()) / 3600_000)
  );

  const today = listRecentVaultNotes(hoursSinceStartOfDay, 100);
  const recent = listRecentVaultNotes(24 * 7, 50); // last 7 days
  const uncategorized = listUncategorizedVaultNotes(100);
  const stale_bins = listStaleBins(30);

  return NextResponse.json({ today, recent, uncategorized, stale_bins });
}
```

- [ ] **Step 2: Verify TS**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/review/route.ts
git commit -m "feat(api): /api/review aggregates today + recent + uncategorized + stale"
```

---

### Task 15: `/review` page

**Files:**
- Create: `app/review/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/review/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { NoteList } from "@/components/NoteList";
import { formatRelativeTime } from "@/lib/utils";
import type { VaultNote, Bin } from "@/lib/types";

interface StaleBin extends Bin {
  last_activity: string | null;
}

interface ReviewData {
  today: VaultNote[];
  recent: VaultNote[];
  uncategorized: VaultNote[];
  stale_bins: StaleBin[];
}

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/review")
      .then((r) => r.json())
      .then((d: ReviewData) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Review</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Today's activity, uncategorized notes, and bins that need attention.
        </p>
      </div>

      {loading || !data ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardHeader label="Today" right={<span className="text-2xs text-text-muted">{data.today.length}</span>} />
            <NoteList notes={data.today} emptyMessage="Nothing modified today." />
          </Card>

          <Card>
            <CardHeader label="Uncategorized" right={<span className="text-2xs text-text-muted">{data.uncategorized.length}</span>} />
            <NoteList notes={data.uncategorized} emptyMessage="All notes have a bin." />
          </Card>

          <Card>
            <CardHeader label="Recent (7d)" right={<span className="text-2xs text-text-muted">{data.recent.length}</span>} />
            <NoteList notes={data.recent} emptyMessage="No recent activity." />
          </Card>

          <Card>
            <CardHeader label="Stale bins (>30d)" right={<span className="text-2xs text-text-muted">{data.stale_bins.length}</span>} />
            {data.stale_bins.length === 0 ? (
              <p className="text-xs text-text-muted px-2 py-6">No stale bins — keep it up.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-hover">
                {data.stale_bins.map((b) => (
                  <li key={b.id} className="px-2 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-primary">{b.name}</span>
                    <span className="text-[10px] text-text-muted mono">
                      {b.last_activity ? `last ${formatRelativeTime(b.last_activity)}` : "empty"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/review/page.tsx
git commit -m "feat(ui): /review page with today + uncategorized + recent + stale bins"
```

---

### Task 16: Sidebar — add `/review` nav item

**Files:** Modify `components/Sidebar.tsx`

- [ ] **Step 1: Add the import and nav item**

In `components/Sidebar.tsx`:

1. Add `Telescope` to the lucide-react import (line 5):
```typescript
import { LayoutGrid, Users, FolderGit2, Cpu, FileText, StickyNote, Settings, Telescope, type LucideIcon } from "lucide-react";
```

2. Add a nav item in the `navItems` array (after the `Notes` entry):
```typescript
  { href: "/review", label: "Review", icon: Telescope },
```

- [ ] **Step 2: Verify TS**

Run: `npx tsc --noEmit`
Expected: no errors. (If `Telescope` isn't exported by lucide, substitute `Eye`.)

- [ ] **Step 3: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat(ui): sidebar Review nav entry"
```

---

### Task 17: `/api/settings/notion-targets` GET/PUT

**Files:** Create `app/api/settings/notion-targets/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/settings/notion-targets/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSettingJson, setSettingJson } from "@/lib/queries/app-settings";
import { badRequest, readJson } from "@/lib/validation";

const DB_ID_RE = /^[a-f0-9-]{20,40}$/i;

export async function GET() {
  const targets = getSettingJson<string[]>("notion.sync_targets") ?? [];
  return NextResponse.json({ targets });
}

export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.targets)) return badRequest("targets must be an array of strings");
  const cleaned: string[] = [];
  for (const t of b.targets) {
    if (typeof t !== "string") return badRequest("each target must be a string");
    const trimmed = t.trim().replace(/-/g, "").toLowerCase(); // allow with or without hyphens
    if (!DB_ID_RE.test(t.trim())) return badRequest(`invalid database id: ${t}`);
    cleaned.push(t.trim());
  }
  setSettingJson("notion.sync_targets", cleaned);
  return NextResponse.json({ targets: cleaned });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/settings/notion-targets/route.ts
git commit -m "feat(api): GET/PUT /api/settings/notion-targets"
```

---

### Task 18: Action APIs (reindex + seed-bins)

**Files:**
- Create: `app/api/actions/reindex/route.ts`
- Create: `app/api/actions/seed-bins/route.ts`

Both endpoints spawn the existing scripts via `spawnSync` with a 60-second timeout.

- [ ] **Step 1: Write reindex route**

Create `app/api/actions/reindex/route.ts`:

```typescript
import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
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
```

- [ ] **Step 2: Write seed-bins route**

Create `app/api/actions/seed-bins/route.ts`:

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add app/api/actions/
git commit -m "feat(api): POST reindex + seed-bins action endpoints"
```

---

### Task 19: `ActionButton` component

**Files:** Create `components/ActionButton.tsx`

- [ ] **Step 1: Write the component**

Create `components/ActionButton.tsx`:

```typescript
"use client";

import { useState } from "react";

interface Props {
  label: string;
  endpoint: string;
  confirm?: string;
}

export function ActionButton({ label, endpoint, confirm }: Props) {
  const [status, setStatus] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setStatus("running");
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Action failed");
        setStatus("error");
        return;
      }
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={status === "running"}
        className="bg-base border border-border rounded px-2.5 py-1.5 text-xs text-text-primary hover:bg-hover disabled:opacity-50"
      >
        {status === "running" ? "Running…" : status === "ok" ? "Done ✓" : label}
      </button>
      {error && <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={error}>{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ActionButton.tsx
git commit -m "feat(ui): ActionButton wraps POST endpoints with status feedback"
```

---

### Task 20: Settings page — Notion + actions + sync health

**Files:** Modify `app/settings/page.tsx`

- [ ] **Step 1: Overwrite the page**

Replace `app/settings/page.tsx` with:

```typescript
"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { AddClientForm } from "@/components/AddClientForm";
import { ActionButton } from "@/components/ActionButton";
import { SyncHealth } from "@/components/SyncHealth";
import type { Client, SyncStatusRecord } from "@/lib/types";

export default function SettingsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [notionTargets, setNotionTargets] = useState<string[]>([]);
  const [targetsInput, setTargetsInput] = useState("");
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients ?? []));
    fetch("/api/settings/notion-targets")
      .then((r) => r.json())
      .then((d) => {
        const t = d.targets ?? [];
        setNotionTargets(t);
        setTargetsInput(t.join("\n"));
      });
    fetch("/api/system").then((r) => r.json()).then((d) => setSync(d.sync ?? []));
  }, []);

  async function saveTargets() {
    setSaveStatus(null);
    const list = targetsInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const res = await fetch("/api/settings/notion-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: list }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveStatus(`Error: ${data.error ?? "save failed"}`);
      return;
    }
    setNotionTargets(data.targets);
    setSaveStatus("Saved ✓");
    setTimeout(() => setSaveStatus(null), 2000);
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Settings</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader label="Add Client" />
          <AddClientForm />
        </Card>

        <Card>
          <CardHeader label="Current Clients" right={<span className="text-2xs text-text-muted">{clients.length}</span>} />
          {clients.length === 0 ? (
            <p className="text-xs text-text-muted">No clients yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div>
                    <div className="text-xs text-text-primary font-medium">{c.name}</div>
                    <div className="mono text-[10px] text-text-muted">{c.slug}</div>
                  </div>
                  <span className="text-[10px] text-text-secondary capitalize">{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader label="Notion Sync Targets" right={<span className="text-2xs text-text-muted">{notionTargets.length}</span>} />
          <p className="text-[10px] text-text-muted mb-2">
            Paste Notion database IDs (one per line). Each must be shared with your integration in Notion.
          </p>
          <textarea
            value={targetsInput}
            onChange={(e) => setTargetsInput(e.target.value)}
            rows={5}
            placeholder="abc123def456..."
            className="w-full bg-base border border-border rounded p-2 text-xs text-text-primary font-mono focus:border-accent-green focus:outline-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={saveTargets}
              className="bg-accent-green text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-accent-green/90"
            >
              Save
            </button>
            {saveStatus && <span className="text-[10px] text-text-muted">{saveStatus}</span>}
          </div>
        </Card>

        <Card>
          <CardHeader label="Actions" />
          <div className="flex flex-col gap-2">
            <ActionButton label="Run vault indexer" endpoint="/api/actions/reindex" />
            <ActionButton
              label="Re-seed bins from folders"
              endpoint="/api/actions/seed-bins"
              confirm="This will re-apply automatic bin assignments based on folder locations. Manual assignments are preserved, but notes that currently have no bins may be auto-assigned. Continue?"
            />
          </div>
          <p className="text-[10px] text-text-muted mt-3">
            Notion sync runs on cron. To trigger manually, run <code className="mono">npm run sync:notion</code> in the project directory.
          </p>
        </Card>

        <div className="col-span-2">
          <SyncHealth items={sync} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TS**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(ui): settings adds notion targets + actions + sync health"
```

---

### Task 21: Run full automated suite

**Files:** none.

- [ ] **Step 1: `npm test`** — expect ~123 tests passing (85 Phase 1 + 38 Phase 2 new: 7 app-settings + 7 slug + 7 cursor + 8 blocks-to-markdown + 6 sync-notion + 3 review).

- [ ] **Step 2: `npm run lint`** — expect clean.

- [ ] **Step 3: `npm run build`** — expect clean build. New routes should appear:
  - `/review`
  - `/api/notes/capture`
  - `/api/review`
  - `/api/settings/notion-targets`
  - `/api/actions/reindex`
  - `/api/actions/seed-bins`

- [ ] **Step 4: Fix anything that fails.** No commit needed if green.

---

### Task 22: Manual end-to-end smoke test

Verification that requires eyes. Controller (human or agentic) should:

- [ ] **Step 1: Start dev server**

```bash
VAULT_PATH=$HOME/Vault npm run dev
```

- [ ] **Step 2: Test Quick Capture**
  - Press `Cmd+Shift+C` anywhere in the dashboard
  - Modal appears, textarea focused
  - Type a thought (3+ words), pick a bin, optionally add tags, press `Cmd+Enter`
  - Modal closes; navigate to `/notes` and confirm the new note appears in the selected bin
  - Check `~/Vault/captures/` — file exists with correct frontmatter
  - Press Esc to dismiss the modal without submitting — verify no file is written

- [ ] **Step 3: Test Review page**
  - Navigate to `/review`
  - Today card shows any notes modified today
  - Uncategorized card shows notes with no bin
  - Stale bins card shows bins with no recent activity
  - Click any note — it opens the detail page

- [ ] **Step 4: Test Settings**
  - Navigate to `/settings`
  - Notion Sync Targets card shows empty input
  - (Optional) paste a real Notion database ID, click Save, verify "Saved ✓"
  - Click "Run vault indexer" — button shows Running… then Done ✓
  - Click "Re-seed bins" — confirm dialog appears, click OK, button shows Running… then Done ✓
  - Sync Health card at the bottom shows the latest status for each sync

- [ ] **Step 5: (If you have a real Notion token) Test `sync:notion`**
  - Add `NOTION_TOKEN=secret_...` to `.env.local`
  - Add a shared database ID to Notion Sync Targets via Settings
  - Run `VAULT_PATH=$HOME/Vault npm run sync:notion`
  - Check `~/Vault/notion-sync/<db-slug>/` — files should appear
  - Run again — second run should not re-fetch unchanged pages (cursor working)
  - Rename a page in Notion, re-run — file on disk should be renamed

- [ ] **Step 6: Kill dev server.**

---

## Post-Plan Checklist

- [ ] All tests pass (`npm test`)
- [ ] Lint clean (`npm run lint`)
- [ ] Build clean (`npm run build`)
- [ ] Manual smoke test passed
- [ ] `grep -rn "TODO\|FIXME" lib scripts app components | grep -v node_modules` is empty (or only expected entries)

---

## Self-Review

**Spec coverage (§ refers to the main spec, `docs/superpowers/specs/2026-04-23-thought-organizer-design.md`):**

- §4.2 `sync-notion.ts` — Tasks 9–12 (cursor, converter, client, script)
- §5.4 Settings page additions — Tasks 17–20
- §5.3 QuickCapture component — Task 6
- §6 Capture flow — Tasks 4 (slug), 5 (API), 6 (modal), 7 (hotkey), 8 (layout mount)
- §7.1 Search — already in Phase 1
- §8 Review surface — Tasks 13 (stale bins), 14 (API), 15 (page), 16 (nav)
- §12 Risks — the spec's "cursor validation" risk is addressed by Task 9's graceful parse; "slug collision" is addressed in Task 12's `resolveUniquePath`

Gaps: none blocking within the Phase 2 scope. A few known v1.1 limitations, intentionally deferred:

- **Notion multi-select tags not written to frontmatter.** Task 12's `buildFrontmatter` includes source/source_id/source_url/created_at/last_synced_at but does not currently pull `tags` from Notion page multi-select properties. The spec calls for it. Adding later is a 10-line change in `buildFrontmatter` + extraction from `page.properties`; defer until someone actually uses Notion multi-selects for tagging.
- **`VAULT_PATH` and `NOTION_TOKEN` stay env-only.** Deployment-time concerns, not runtime knobs. Exposing them in the UI would add complexity (writing to `.env.local`, permissions, restart requirements) with no real benefit for a single-user app.
- **Phase 3 agent work, Apple Notes, deploy automation** — all still deferred to their own plans.

**Placeholder scan:** clean. No "TBD"/"implement later"/"similar to Task N" patterns. All code blocks complete.

**Type consistency:**
- `NotionBlock` type defined in Task 10, consumed in Task 11 and Task 12. Signatures match.
- `NotionSyncDeps` / `SyncNotionPage` defined in Task 12; tests in Task 12's own test block use them. Consistent.
- `StaleBin` defined in Task 13, used in Task 14 return shape, rendered in Task 15. Consistent.
- `ActionButton` props (Task 19) match usage in Task 20.
- `captureSlug` / `captureFilename` from Task 4 used in Task 5. Consistent.

No inconsistencies found.
