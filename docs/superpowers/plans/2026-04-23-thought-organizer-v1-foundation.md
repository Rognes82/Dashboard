# Thought Organizer v1.0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-side foundation of the Thought Organizer feature — schema migration, vault indexer, query layer, API routes, and a new `/notes` UI with bin tree + search + detail view. Captures and Notion sync come in the Phase 2 plan.

**Architecture:** The dashboard becomes an index + viewport over an Obsidian markdown vault at `~/Vault/`. SQLite holds metadata (bin hierarchy, note index, FTS5 search). A cron-driven indexer script walks the vault every 5 min and keeps SQLite in sync. Content itself is never stored in SQLite — the UI reads markdown files on demand for detail views.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3 (WAL + FTS5), Vitest, `gray-matter` (frontmatter), `fast-glob` (vault walking), `@node-rs/xxhash` (content hashing), `react-markdown` + `remark-gfm` (detail view rendering).

**Spec reference:** `docs/superpowers/specs/2026-04-23-thought-organizer-design.md`

---

## File Structure

**Created:**
- `lib/vault/hash.ts` — xxhash wrapper
- `lib/vault/frontmatter.ts` — gray-matter wrapper with typed parsing
- `lib/vault/markdown.ts` — plain-text extraction for FTS indexing
- `lib/queries/vault-notes.ts` — vault_notes + FTS5 search query layer
- `lib/queries/bins.ts` — bins + note_bins CRUD, tree assembly, merge
- `scripts/vault-indexer.ts` — cron-driven file scan + upsert
- `scripts/sync-obsidian.ts` — seed scan + bin auto-creation
- `app/api/notes/[id]/route.ts` — note detail API (reads file content)
- `app/api/notes/search/route.ts` — FTS5 search API
- `app/api/bins/route.ts` — bins list + create
- `app/api/bins/[id]/route.ts` — bin patch + delete
- `app/api/bins/[id]/assign/route.ts` — assign note to bin
- `app/api/bins/[id]/assign/[noteId]/route.ts` — unassign note from bin
- `app/notes/[id]/page.tsx` — note detail page with react-markdown
- `components/BinTree.tsx` — recursive bin navigation
- `components/NoteList.tsx` — note list with source chips
- `components/SearchBar.tsx` — FTS5 search input with debounce
- `tests/lib/vault/hash.test.ts`
- `tests/lib/vault/frontmatter.test.ts`
- `tests/lib/vault/markdown.test.ts`
- `tests/lib/queries/vault-notes.test.ts`
- `tests/lib/queries/bins.test.ts`
- `tests/scripts/vault-indexer.test.ts`
- `tests/scripts/sync-obsidian.test.ts`
- `tests/fixtures/vault/` — test vault with sample markdown files

**Modified:**
- `package.json` — new dependencies
- `lib/schema.sql` — drop `notes`, add `vault_notes` + `vault_notes_fts` + `bins` + `note_bins` + `note_tags` + indexes, alter `sync_status`
- `lib/types.ts` — remove `Note` / `NoteSource`; add `VaultNote`, `Bin`, `NoteBin`, `NoteTag`
- `lib/queries/sync-status.ts` — support `cursor` read/write
- `app/api/notes/route.ts` — rewrite for new `vault_notes` shape
- `app/api/clients/[slug]/route.ts` — swap `listNotesByClient` for `listVaultNotesByClient`
- `app/clients/[slug]/page.tsx` — swap query name + shape
- `app/notes/page.tsx` — rewrite for bin browser + search

**Deleted:**
- `lib/queries/notes.ts`
- `tests/lib/queries/notes.test.ts`

---

## Task Order

The plan is TDD-first for data-layer work. Scripts and API routes also get tests. UI components get smoke coverage only (real verification is manual in Task 28).

Tasks 1–3: setup + schema + types (no tests — this is plumbing)
Tasks 4–6: vault utilities (pure fns, easy TDD)
Tasks 7–10: query layer (DB-integration TDD using `resetDbForTesting` pattern)
Tasks 11–14: scripts (integration-style tests against a fixture vault)
Tasks 15–21: API routes (minimal tests, depend on query layer)
Tasks 22–27: UI (smoke only, defer to manual verification)
Task 28: manual smoke test

---

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
npm install @notionhq/client@^5.12 gray-matter@^4.0 fast-glob@^3.3 @node-rs/xxhash@^1.7 react-markdown@^9.0 remark-gfm@^4.0
```

Expected: packages added to `dependencies`; `package-lock.json` updated. No install errors.

Note: `@notionhq/client` is installed now even though Phase 1 doesn't use it — keeps the dependency set stable for Phase 2 and avoids a separate install commit later.

- [ ] **Step 2: Verify existing tests still pass**

Run:
```bash
npm test
```

Expected: all 40 tests pass (pre-existing state). If any fail, one of the new deps pulled in a conflicting peer — investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add vault + markdown + notion libs for thought organizer"
```

---

### Task 2: Schema migration

**Files:**
- Modify: `lib/schema.sql`

- [ ] **Step 1: Replace the schema file**

Overwrite `lib/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  pipeline_stage TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  branch TEXT,
  last_commit_at TEXT,
  last_commit_message TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  project_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  file_type TEXT,
  size INTEGER,
  modified_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Vault notes — index only. Content lives in markdown files on disk.
CREATE TABLE IF NOT EXISTS vault_notes (
  id TEXT PRIMARY KEY,
  vault_path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  last_indexed_at TEXT NOT NULL,
  deleted_at TEXT,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

-- FTS5 search over vault content.
-- STANDALONE table — not tied to vault_notes via external content. The indexer
-- explicitly INSERTs/UPDATEs/DELETEs rows here using the same rowid as the
-- corresponding vault_notes row. snippet() works because the table stores its
-- own copy of title/content/tags.
CREATE VIRTUAL TABLE IF NOT EXISTS vault_notes_fts USING fts5(
  title, content, tags,
  tokenize = 'porter unicode61 remove_diacritics 1'
);

CREATE TABLE IF NOT EXISTS bins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
  source_seed TEXT UNIQUE,
  created_at TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS note_bins (
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  bin_id TEXT NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL CHECK (assigned_by IN ('auto', 'manual', 'agent')),
  PRIMARY KEY (note_id, bin_id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  schedule TEXT,
  host TEXT NOT NULL DEFAULT 'mac_mini',
  status TEXT NOT NULL DEFAULT 'stopped',
  last_run_at TEXT,
  last_output TEXT,
  config_path TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  agent_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sync_status (
  sync_name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  cursor TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);
CREATE INDEX IF NOT EXISTS idx_vault_notes_source ON vault_notes(source);
CREATE INDEX IF NOT EXISTS idx_vault_notes_modified ON vault_notes(modified_at);
CREATE INDEX IF NOT EXISTS idx_vault_notes_client ON vault_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_vault_notes_project ON vault_notes(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_notes_source_id ON vault_notes(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vault_notes_deleted ON vault_notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bins_parent ON bins(parent_bin_id);
CREATE INDEX IF NOT EXISTS idx_note_bins_note ON note_bins(note_id);
CREATE INDEX IF NOT EXISTS idx_note_bins_bin ON note_bins(bin_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_client_id ON activity(client_id);
```

Note: the old `notes` table is removed entirely from the schema file. The `DROP TABLE notes` isn't in the schema file because the schema is applied with `CREATE ... IF NOT EXISTS` — for the existing DB we drop manually in Step 2.

- [ ] **Step 2: Drop the old notes table and re-init**

Run:
```bash
sqlite3 data/dashboard.db "DROP TABLE IF EXISTS notes;"
npm run init-db
```

Expected: `Database initialized at data/dashboard.db`. No errors.

- [ ] **Step 3: Verify the new tables exist and FTS5 works**

Run:
```bash
sqlite3 data/dashboard.db ".tables"
sqlite3 data/dashboard.db "SELECT count(*) FROM vault_notes_fts;"
```

Expected:
- `.tables` lists `vault_notes`, `vault_notes_fts`, `bins`, `note_bins`, `note_tags` (and the existing tables), but NO `notes`
- The count returns `0`

- [ ] **Step 4: Commit**

```bash
git add lib/schema.sql
git commit -m "feat(schema): drop notes, add vault_notes + bins + FTS5"
```

---

### Task 3: Update types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `lib/types.ts` with:

```typescript
export type ClientStatus = "active" | "paused" | "completed";
export type FileSource = "local" | "gdrive" | "notion";
export type VaultNoteSource = "notion" | "obsidian" | "capture" | "apple-notes";
export type AssignedBy = "auto" | "manual" | "agent";
export type AgentType = "cron" | "discord_bot" | "daemon" | "script" | "manual";
export type AgentStatus = "running" | "stopped" | "errored";
export type SyncStatus = "ok" | "error";

export interface Client {
  id: string;
  name: string;
  slug: string;
  status: ClientStatus;
  pipeline_stage: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_id: string | null;
  name: string;
  path: string;
  repo_url: string | null;
  branch: string | null;
  last_commit_at: string | null;
  last_commit_message: string | null;
  status: "active" | "inactive";
}

export interface FileRecord {
  id: string;
  client_id: string | null;
  project_id: string | null;
  name: string;
  path: string;
  source: FileSource;
  source_url: string | null;
  file_type: string | null;
  size: number | null;
  modified_at: string | null;
}

export interface VaultNote {
  id: string;
  vault_path: string;
  title: string;
  source: VaultNoteSource;
  source_id: string | null;
  source_url: string | null;
  content_hash: string;
  created_at: string;
  modified_at: string;
  last_indexed_at: string;
  deleted_at: string | null;
  client_id: string | null;
  project_id: string | null;
}

export interface Bin {
  id: string;
  name: string;
  parent_bin_id: string | null;
  source_seed: string | null;
  created_at: string;
  sort_order: number;
}

export interface BinNode extends Bin {
  children: BinNode[];
  note_count: number;
}

export interface NoteBin {
  note_id: string;
  bin_id: string;
  assigned_at: string;
  assigned_by: AssignedBy;
}

export interface NoteTag {
  note_id: string;
  tag: string;
}

export interface VaultNoteSearchHit {
  note: VaultNote;
  snippet: string;
  rank: number;
}

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  schedule: string | null;
  host: string;
  status: AgentStatus;
  last_run_at: string | null;
  last_output: string | null;
  config_path: string | null;
}

export interface ActivityEntry {
  id: string;
  client_id: string | null;
  agent_id: string | null;
  source: string;
  event_type: string;
  title: string;
  detail: string | null;
  timestamp: string;
}

export interface SyncStatusRecord {
  sync_name: string;
  last_run_at: string;
  status: SyncStatus;
  error_message: string | null;
  duration_ms: number | null;
  cursor: string | null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: two categories of errors — (a) files that imported `Note` or `NoteSource` now fail (that's good, we'll fix them); (b) `sync-status.ts` needs a small fix (that's next). No other errors.

Note the failing files — we'll update them in later tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): replace Note with VaultNote + Bin + NoteBin + NoteTag"
```

---

### Task 4: Vault hash utility

**Files:**
- Create: `lib/vault/hash.ts`
- Create: `tests/lib/vault/hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/vault/hash.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hashContent } from "../../../lib/vault/hash";

describe("hashContent", () => {
  it("returns a stable hex string for the same input", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("handles empty input", () => {
    expect(hashContent("")).toMatch(/^[0-9a-f]+$/);
  });

  it("handles unicode", () => {
    expect(hashContent("hello 🎉")).not.toBe(hashContent("hello"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/vault/hash.test.ts
```

Expected: FAIL with "Cannot find module '../../../lib/vault/hash'".

- [ ] **Step 3: Write minimal implementation**

Create `lib/vault/hash.ts`:

```typescript
import { xxh64 } from "@node-rs/xxhash";

export function hashContent(content: string): string {
  return xxh64(content).toString(16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- tests/lib/vault/hash.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/hash.ts tests/lib/vault/hash.test.ts
git commit -m "feat(vault): xxhash wrapper for content change detection"
```

---

### Task 5: Frontmatter parser

**Files:**
- Create: `lib/vault/frontmatter.ts`
- Create: `tests/lib/vault/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/vault/frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../../lib/vault/frontmatter";

describe("parseFrontmatter", () => {
  it("extracts frontmatter fields and body", () => {
    const raw = `---
source: notion
source_id: abc-123
tags: [reels, tokyo]
bins: [bin-1, bin-2]
---
# Hello

This is the body.
`;
    const result = parseFrontmatter(raw);
    expect(result.data.source).toBe("notion");
    expect(result.data.source_id).toBe("abc-123");
    expect(result.data.tags).toEqual(["reels", "tokyo"]);
    expect(result.data.bins).toEqual(["bin-1", "bin-2"]);
    expect(result.body.trim()).toBe("# Hello\n\nThis is the body.");
  });

  it("returns empty data and raw body when there is no frontmatter", () => {
    const raw = "# Just a heading\n\nSome body.";
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("extracts inline hashtags from the body", () => {
    const raw = "Text with #tag1 and #nested/tag2 but not in code \\`#notag\\`.";
    const tags = extractInlineTags(raw);
    expect(tags).toContain("tag1");
    expect(tags).toContain("nested/tag2");
    expect(tags).not.toContain("notag");
  });
});

import { extractInlineTags } from "../../../lib/vault/frontmatter";
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/vault/frontmatter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/vault/frontmatter.ts`:

```typescript
import matter from "gray-matter";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const { data, content } = matter(raw);
  return { data: data as Record<string, unknown>, body: content };
}

const INLINE_TAG_RE = /(?<![`\w])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function extractInlineTags(body: string): string[] {
  const withoutFences = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const found = new Set<string>();
  for (const match of withoutFences.matchAll(INLINE_TAG_RE)) {
    found.add(match[1]);
  }
  return Array.from(found);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- tests/lib/vault/frontmatter.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/frontmatter.ts tests/lib/vault/frontmatter.test.ts
git commit -m "feat(vault): frontmatter + inline hashtag parsing"
```

---

### Task 6: Markdown → plain-text extractor (for FTS)

**Files:**
- Create: `lib/vault/markdown.ts`
- Create: `tests/lib/vault/markdown.test.ts`

The FTS5 index stores plain text extracted from markdown, not the raw markdown. This avoids search hits on markdown syntax characters and produces better snippets.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/vault/markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { markdownToPlainText, deriveTitle } from "../../../lib/vault/markdown";

describe("markdownToPlainText", () => {
  it("strips headings, emphasis, and code fences", () => {
    const md = `# Heading
Some **bold** and *italic* text.

\`\`\`typescript
const x = 1;
\`\`\`

And a [link](https://example.com).`;
    const out = markdownToPlainText(md);
    expect(out).toContain("Heading");
    expect(out).toContain("bold");
    expect(out).toContain("italic");
    expect(out).toContain("link");
    expect(out).not.toContain("**");
    expect(out).not.toContain("```");
    expect(out).not.toContain("https://example.com");
  });

  it("flattens wikilinks to their display text", () => {
    expect(markdownToPlainText("See [[Project Alpha]] and [[Note|shown]].")).toContain("Project Alpha");
    expect(markdownToPlainText("See [[Note|shown]].")).toContain("shown");
  });
});

describe("deriveTitle", () => {
  it("uses frontmatter title if present", () => {
    expect(deriveTitle({ title: "From Front" }, "# Heading\nbody", "fallback.md")).toBe("From Front");
  });

  it("falls back to first heading", () => {
    expect(deriveTitle({}, "# Heading\nbody", "fallback.md")).toBe("Heading");
  });

  it("falls back to filename sans extension when no heading", () => {
    expect(deriveTitle({}, "just text", "notes/my-note.md")).toBe("my-note");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/vault/markdown.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/vault/markdown.ts`:

```typescript
import path from "path";

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const EMPHASIS_RE = /(\*\*|__|\*|_)(.*?)\1/g;
const WIKILINK_RE = /!?\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const MD_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;
const HR_RE = /^-{3,}\s*$/gm;

export function markdownToPlainText(md: string): string {
  let out = md;
  out = out.replace(FENCE_RE, " ");
  out = out.replace(INLINE_CODE_RE, (m) => m.slice(1, -1));
  out = out.replace(IMAGE_RE, " ");
  out = out.replace(WIKILINK_RE, (_m, target, alias) => alias ?? target);
  out = out.replace(MD_LINK_RE, "$1");
  out = out.replace(HEADING_RE, "");
  out = out.replace(EMPHASIS_RE, "$2");
  out = out.replace(HR_RE, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

const FIRST_HEADING_RE = /^#{1,6}\s+(.+?)\s*$/m;

export function deriveTitle(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) return fmTitle.trim();
  const match = body.match(FIRST_HEADING_RE);
  if (match) return match[1].trim();
  return path.basename(filePath, path.extname(filePath));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- tests/lib/vault/markdown.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/vault/markdown.ts tests/lib/vault/markdown.test.ts
git commit -m "feat(vault): markdown→plain text + title derivation"
```

---

### Task 7: Delete the old notes query file

**Files:**
- Delete: `lib/queries/notes.ts`
- Delete: `tests/lib/queries/notes.test.ts`

- [ ] **Step 1: Delete the files**

Run:
```bash
rm lib/queries/notes.ts tests/lib/queries/notes.test.ts
```

- [ ] **Step 2: Verify tests still collectable (expect failures in callers)**

Run:
```bash
npm test 2>&1 | head -30
```

Expected: `app/clients/[slug]/page.tsx`, `app/api/clients/[slug]/route.ts`, `app/notes/page.tsx`, and `app/api/notes/route.ts` will fail to compile since they import from the deleted module. That's fine — we fix them in later tasks. The test runner should still run the non-broken tests.

- [ ] **Step 3: Commit**

```bash
git add -u lib/queries/notes.ts tests/lib/queries/notes.test.ts
git commit -m "chore: delete old notes query layer (replaced by vault-notes)"
```

---

### Task 8: Vault notes query layer + FTS search

**Files:**
- Create: `lib/queries/vault-notes.ts`
- Create: `tests/lib/queries/vault-notes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/queries/vault-notes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  upsertVaultNote,
  getVaultNoteById,
  getVaultNoteByPath,
  getVaultNoteBySourceId,
  listVaultNotes,
  listVaultNotesByClient,
  listRecentVaultNotes,
  listUncategorizedVaultNotes,
  softDeleteVaultNote,
  hardDeleteVaultNote,
  updateFtsRow,
  deleteFtsRow,
  searchVaultNotes,
} from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-vault-notes.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function fixtureNote(overrides: Partial<Parameters<typeof upsertVaultNote>[0]> = {}) {
  return upsertVaultNote({
    vault_path: "notes/alpha.md",
    title: "Alpha",
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "hash-1",
    modified_at: "2026-04-23T10:00:00Z",
    ...overrides,
  });
}

describe("vault-notes queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertVaultNote creates a row on first call", () => {
    const note = fixtureNote();
    expect(note.id).toHaveLength(26);
    expect(note.vault_path).toBe("notes/alpha.md");
    expect(note.title).toBe("Alpha");
  });

  it("upsertVaultNote updates the same row on second call by path", () => {
    const first = fixtureNote();
    const second = fixtureNote({ title: "Alpha Renamed", content_hash: "hash-2" });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Alpha Renamed");
    expect(second.content_hash).toBe("hash-2");
  });

  it("upsertVaultNote with source_id updates by source_id even if path changes", () => {
    const first = fixtureNote({ source: "notion", source_id: "notion-page-1", vault_path: "notion-sync/db/alpha.md" });
    const second = upsertVaultNote({
      vault_path: "notion-sync/db/alpha-renamed.md",
      title: "Alpha Renamed",
      source: "notion",
      source_id: "notion-page-1",
      source_url: null,
      content_hash: "hash-2",
      modified_at: "2026-04-23T10:05:00Z",
    });
    expect(second.id).toBe(first.id);
    expect(second.vault_path).toBe("notion-sync/db/alpha-renamed.md");
  });

  it("getVaultNoteById returns null for missing", () => {
    expect(getVaultNoteById("nope")).toBeNull();
  });

  it("getVaultNoteByPath returns the row", () => {
    const note = fixtureNote();
    expect(getVaultNoteByPath("notes/alpha.md")?.id).toBe(note.id);
  });

  it("getVaultNoteBySourceId returns only when not null", () => {
    fixtureNote({ source: "notion", source_id: "nx-1" });
    expect(getVaultNoteBySourceId("nx-1")?.source_id).toBe("nx-1");
    expect(getVaultNoteBySourceId("missing")).toBeNull();
  });

  it("listVaultNotes orders by modified_at desc", () => {
    fixtureNote({ vault_path: "a.md", title: "A", modified_at: "2026-04-23T10:00:00Z" });
    fixtureNote({ vault_path: "b.md", title: "B", modified_at: "2026-04-23T11:00:00Z" });
    const list = listVaultNotes(10);
    expect(list[0].title).toBe("B");
    expect(list[1].title).toBe("A");
  });

  it("softDeleteVaultNote sets deleted_at and hides from list", () => {
    const note = fixtureNote();
    softDeleteVaultNote(note.id);
    expect(listVaultNotes(10)).toHaveLength(0);
    expect(getVaultNoteById(note.id)?.deleted_at).not.toBeNull();
  });

  it("hardDeleteVaultNote removes the row entirely", () => {
    const note = fixtureNote();
    hardDeleteVaultNote(note.id);
    expect(getVaultNoteById(note.id)).toBeNull();
  });

  it("updateFtsRow + searchVaultNotes returns a hit with snippet", () => {
    const note = fixtureNote({ title: "Tokyo reel ideas" });
    updateFtsRow({ note_id: note.id, title: note.title, plain_text: "Some thoughts about tokyo travel content", tags: "reels tokyo" });
    const hits = searchVaultNotes("tokyo");
    expect(hits).toHaveLength(1);
    expect(hits[0].note.id).toBe(note.id);
    expect(hits[0].snippet).toContain("tokyo");
  });

  it("deleteFtsRow removes the FTS entry", () => {
    const note = fixtureNote({ title: "Tokyo reel" });
    updateFtsRow({ note_id: note.id, title: note.title, plain_text: "body", tags: "" });
    deleteFtsRow(note.id);
    expect(searchVaultNotes("tokyo")).toHaveLength(0);
  });

  it("listUncategorizedVaultNotes returns only notes with no bin", () => {
    const a = fixtureNote({ vault_path: "a.md" });
    const b = fixtureNote({ vault_path: "b.md" });
    const db = resetDbForTesting(TEST_DB);
    db.prepare("INSERT INTO bins (id, name, created_at) VALUES ('bin1', 'Bin One', '2026-04-23T10:00:00Z')").run();
    db.prepare(
      "INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, 'bin1', '2026-04-23T10:00:00Z', 'manual')"
    ).run(a.id);
    const uncat = listUncategorizedVaultNotes();
    expect(uncat).toHaveLength(1);
    expect(uncat[0].id).toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/queries/vault-notes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/queries/vault-notes.ts`:

```typescript
import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { VaultNote, VaultNoteSource, VaultNoteSearchHit } from "../types";

export interface UpsertVaultNoteInput {
  vault_path: string;
  title: string;
  source: VaultNoteSource;
  source_id: string | null;
  source_url: string | null;
  content_hash: string;
  modified_at: string;
  created_at?: string;
  client_id?: string | null;
  project_id?: string | null;
}

export function upsertVaultNote(input: UpsertVaultNoteInput): VaultNote {
  const db = getDb();
  const now = nowIso();
  const existingBySourceId =
    input.source_id !== null ? getVaultNoteBySourceId(input.source_id) : null;
  const existingByPath = existingBySourceId ? null : getVaultNoteByPath(input.vault_path);
  const existing = existingBySourceId ?? existingByPath;

  if (existing) {
    db.prepare(
      `UPDATE vault_notes SET
         vault_path = ?, title = ?, source = ?, source_id = ?, source_url = ?,
         content_hash = ?, modified_at = ?, last_indexed_at = ?, deleted_at = NULL,
         client_id = COALESCE(?, client_id), project_id = COALESCE(?, project_id)
       WHERE id = ?`
    ).run(
      input.vault_path,
      input.title,
      input.source,
      input.source_id,
      input.source_url,
      input.content_hash,
      input.modified_at,
      now,
      input.client_id ?? null,
      input.project_id ?? null,
      existing.id
    );
    return getVaultNoteById(existing.id)!;
  }

  const id = newId();
  db.prepare(
    `INSERT INTO vault_notes (
       id, vault_path, title, source, source_id, source_url, content_hash,
       created_at, modified_at, last_indexed_at, client_id, project_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.vault_path,
    input.title,
    input.source,
    input.source_id,
    input.source_url,
    input.content_hash,
    input.created_at ?? now,
    input.modified_at,
    now,
    input.client_id ?? null,
    input.project_id ?? null
  );
  return getVaultNoteById(id)!;
}

export function getVaultNoteById(id: string): VaultNote | null {
  const row = getDb().prepare("SELECT * FROM vault_notes WHERE id = ?").get(id) as VaultNote | undefined;
  return row ?? null;
}

export function getVaultNoteByPath(vault_path: string): VaultNote | null {
  const row = getDb()
    .prepare("SELECT * FROM vault_notes WHERE vault_path = ?")
    .get(vault_path) as VaultNote | undefined;
  return row ?? null;
}

export function getVaultNoteBySourceId(source_id: string): VaultNote | null {
  const row = getDb()
    .prepare("SELECT * FROM vault_notes WHERE source_id = ?")
    .get(source_id) as VaultNote | undefined;
  return row ?? null;
}

export function listVaultNotes(limit = 200): VaultNote[] {
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(limit) as VaultNote[];
}

export function listVaultNotesByClient(client_id: string, limit = 50): VaultNote[] {
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE client_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(client_id, limit) as VaultNote[];
}

export function listVaultNotesByBin(bin_id: string, limit = 500): VaultNote[] {
  return getDb()
    .prepare(
      `SELECT vn.* FROM vault_notes vn
       JOIN note_bins nb ON nb.note_id = vn.id
       WHERE nb.bin_id = ? AND vn.deleted_at IS NULL
       ORDER BY vn.modified_at DESC
       LIMIT ?`
    )
    .all(bin_id, limit) as VaultNote[];
}

export function listRecentVaultNotes(hours = 24, limit = 100): VaultNote[] {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE modified_at >= ? AND deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(cutoff, limit) as VaultNote[];
}

export function listUncategorizedVaultNotes(limit = 200): VaultNote[] {
  return getDb()
    .prepare(
      `SELECT vn.* FROM vault_notes vn
       WHERE vn.deleted_at IS NULL
         AND vn.id NOT IN (SELECT note_id FROM note_bins)
       ORDER BY vn.modified_at DESC
       LIMIT ?`
    )
    .all(limit) as VaultNote[];
}

export function listAllIndexedPaths(): string[] {
  return (getDb()
    .prepare("SELECT vault_path FROM vault_notes WHERE deleted_at IS NULL")
    .all() as { vault_path: string }[]).map((r) => r.vault_path);
}

export function softDeleteVaultNote(id: string): void {
  getDb().prepare("UPDATE vault_notes SET deleted_at = ? WHERE id = ?").run(nowIso(), id);
  deleteFtsRow(id);
}

export function hardDeleteVaultNote(id: string): void {
  getDb().prepare("DELETE FROM vault_notes WHERE id = ?").run(id);
  deleteFtsRow(id);
}

export function updateFtsRow(input: { note_id: string; title: string; plain_text: string; tags: string }): void {
  const db = getDb();
  const rowid = (db.prepare("SELECT rowid FROM vault_notes WHERE id = ?").get(input.note_id) as { rowid: number } | undefined)?.rowid;
  if (rowid === undefined) return;
  db.prepare("DELETE FROM vault_notes_fts WHERE rowid = ?").run(rowid);
  db.prepare(
    "INSERT INTO vault_notes_fts (rowid, title, content, tags) VALUES (?, ?, ?, ?)"
  ).run(rowid, input.title, input.plain_text, input.tags);
}

export function deleteFtsRow(note_id: string): void {
  const db = getDb();
  const rowid = (db.prepare("SELECT rowid FROM vault_notes WHERE id = ?").get(note_id) as { rowid: number } | undefined)?.rowid;
  if (rowid === undefined) return;
  db.prepare("DELETE FROM vault_notes_fts WHERE rowid = ?").run(rowid);
}

export function searchVaultNotes(query: string, limit = 50): VaultNoteSearchHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT vn.*, snippet(vault_notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet, rank
       FROM vault_notes_fts
       JOIN vault_notes vn ON vn.rowid = vault_notes_fts.rowid
       WHERE vault_notes_fts MATCH ? AND vn.deleted_at IS NULL
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as (VaultNote & { snippet: string; rank: number })[];
  return rows.map((r) => {
    const { snippet, rank, ...note } = r;
    return { note: note as VaultNote, snippet, rank };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- tests/lib/queries/vault-notes.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/vault-notes.ts tests/lib/queries/vault-notes.test.ts
git commit -m "feat(queries): vault_notes CRUD + FTS5 search"
```

---

### Task 9: Bins query layer

**Files:**
- Create: `lib/queries/bins.ts`
- Create: `tests/lib/queries/bins.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/queries/bins.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  createBin,
  getBinById,
  listBins,
  listBinTree,
  updateBin,
  deleteBin,
  assignNoteToBin,
  unassignNoteFromBin,
  listBinsForNote,
  mergeBin,
  getOrCreateBinBySeed,
} from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-bins.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function fixtureNote(vault_path = "notes/a.md") {
  return upsertVaultNote({
    vault_path,
    title: "X",
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "h",
    modified_at: "2026-04-23T10:00:00Z",
  });
}

describe("bins queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("createBin + getBinById round-trip", () => {
    const bin = createBin({ name: "Content" });
    expect(bin.id).toHaveLength(26);
    expect(getBinById(bin.id)?.name).toBe("Content");
  });

  it("createBin with parent nests correctly", () => {
    const parent = createBin({ name: "Content" });
    const child = createBin({ name: "Reels", parent_bin_id: parent.id });
    expect(child.parent_bin_id).toBe(parent.id);
  });

  it("listBinTree builds nested structure with note counts", () => {
    const parent = createBin({ name: "Content" });
    const child = createBin({ name: "Reels", parent_bin_id: parent.id });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: child.id, assigned_by: "manual" });
    const tree = listBinTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Content");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("Reels");
    expect(tree[0].children[0].note_count).toBe(1);
  });

  it("updateBin changes name and parent", () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const updated = updateBin(b.id, { name: "B2", parent_bin_id: a.id });
    expect(updated?.name).toBe("B2");
    expect(updated?.parent_bin_id).toBe(a.id);
  });

  it("deleteBin cascades to children and note_bins", () => {
    const parent = createBin({ name: "P" });
    const child = createBin({ name: "C", parent_bin_id: parent.id });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: child.id, assigned_by: "manual" });
    deleteBin(parent.id);
    expect(getBinById(parent.id)).toBeNull();
    expect(getBinById(child.id)).toBeNull();
    expect(listBinsForNote(note.id)).toHaveLength(0);
  });

  it("assignNoteToBin is idempotent on (note, bin) pair", () => {
    const bin = createBin({ name: "B" });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "auto" });
    const bins = listBinsForNote(note.id);
    expect(bins).toHaveLength(1);
  });

  it("unassignNoteFromBin removes the row", () => {
    const bin = createBin({ name: "B" });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
    unassignNoteFromBin(note.id, bin.id);
    expect(listBinsForNote(note.id)).toHaveLength(0);
  });

  it("mergeBin moves all note_bins from source to target and deletes source", () => {
    const src = createBin({ name: "Source" });
    const tgt = createBin({ name: "Target" });
    const n1 = fixtureNote("a.md");
    const n2 = fixtureNote("b.md");
    assignNoteToBin({ note_id: n1.id, bin_id: src.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: n2.id, bin_id: src.id, assigned_by: "auto" });
    mergeBin(src.id, tgt.id);
    expect(getBinById(src.id)).toBeNull();
    expect(listBinsForNote(n1.id).map((b) => b.id)).toContain(tgt.id);
    expect(listBinsForNote(n2.id).map((b) => b.id)).toContain(tgt.id);
  });

  it("mergeBin handles overlapping memberships without duplicate PK violation", () => {
    const src = createBin({ name: "Source" });
    const tgt = createBin({ name: "Target" });
    const n = fixtureNote();
    assignNoteToBin({ note_id: n.id, bin_id: src.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: n.id, bin_id: tgt.id, assigned_by: "manual" });
    mergeBin(src.id, tgt.id);
    expect(listBinsForNote(n.id)).toHaveLength(1);
  });

  it("getOrCreateBinBySeed is idempotent", () => {
    const a = getOrCreateBinBySeed({ source_seed: "obsidian:Content", name: "Content" });
    const b = getOrCreateBinBySeed({ source_seed: "obsidian:Content", name: "Content" });
    expect(a.id).toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/queries/bins.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/queries/bins.ts`:

```typescript
import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { Bin, BinNode, AssignedBy } from "../types";

export function createBin(input: {
  name: string;
  parent_bin_id?: string | null;
  source_seed?: string | null;
  sort_order?: number;
}): Bin {
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.parent_bin_id ?? null,
    input.source_seed ?? null,
    nowIso(),
    input.sort_order ?? 0
  );
  return getBinById(id)!;
}

export function getBinById(id: string): Bin | null {
  const row = getDb().prepare("SELECT * FROM bins WHERE id = ?").get(id) as Bin | undefined;
  return row ?? null;
}

export function getBinBySeed(source_seed: string): Bin | null {
  const row = getDb().prepare("SELECT * FROM bins WHERE source_seed = ?").get(source_seed) as Bin | undefined;
  return row ?? null;
}

export function getOrCreateBinBySeed(input: {
  source_seed: string;
  name: string;
  parent_bin_id?: string | null;
}): Bin {
  const existing = getBinBySeed(input.source_seed);
  if (existing) return existing;
  return createBin({
    name: input.name,
    parent_bin_id: input.parent_bin_id ?? null,
    source_seed: input.source_seed,
  });
}

export function listBins(): Bin[] {
  return getDb().prepare("SELECT * FROM bins ORDER BY sort_order ASC, name ASC").all() as Bin[];
}

export function listBinTree(): BinNode[] {
  const db = getDb();
  const bins = listBins();
  const counts = db
    .prepare(
      `SELECT bin_id, COUNT(*) as n FROM note_bins
       JOIN vault_notes ON vault_notes.id = note_bins.note_id AND vault_notes.deleted_at IS NULL
       GROUP BY bin_id`
    )
    .all() as { bin_id: string; n: number }[];
  const countMap = new Map(counts.map((c) => [c.bin_id, c.n]));
  const nodeMap = new Map<string, BinNode>();
  for (const bin of bins) {
    nodeMap.set(bin.id, { ...bin, children: [], note_count: countMap.get(bin.id) ?? 0 });
  }
  const roots: BinNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_bin_id && nodeMap.has(node.parent_bin_id)) {
      nodeMap.get(node.parent_bin_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function updateBin(id: string, input: {
  name?: string;
  parent_bin_id?: string | null;
  sort_order?: number;
}): Bin | null {
  const existing = getBinById(id);
  if (!existing) return null;
  const db = getDb();
  db.prepare(
    "UPDATE bins SET name = ?, parent_bin_id = ?, sort_order = ? WHERE id = ?"
  ).run(
    input.name ?? existing.name,
    input.parent_bin_id === undefined ? existing.parent_bin_id : input.parent_bin_id,
    input.sort_order ?? existing.sort_order,
    id
  );
  return getBinById(id);
}

export function deleteBin(id: string): void {
  getDb().prepare("DELETE FROM bins WHERE id = ?").run(id);
}

export function assignNoteToBin(input: {
  note_id: string;
  bin_id: string;
  assigned_by: AssignedBy;
}): void {
  getDb().prepare(
    `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(note_id, bin_id) DO NOTHING`
  ).run(input.note_id, input.bin_id, nowIso(), input.assigned_by);
}

export function unassignNoteFromBin(note_id: string, bin_id: string): void {
  getDb().prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(note_id, bin_id);
}

export function listBinsForNote(note_id: string): Bin[] {
  return getDb()
    .prepare(
      `SELECT b.* FROM bins b
       JOIN note_bins nb ON nb.bin_id = b.id
       WHERE nb.note_id = ?
       ORDER BY b.name ASC`
    )
    .all(note_id) as Bin[];
}

export function mergeBin(source_id: string, target_id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
       SELECT note_id, ?, assigned_at, assigned_by FROM note_bins WHERE bin_id = ?
       ON CONFLICT(note_id, bin_id) DO NOTHING`
    ).run(target_id, source_id);
    db.prepare("DELETE FROM note_bins WHERE bin_id = ?").run(source_id);
    db.prepare("DELETE FROM bins WHERE id = ?").run(source_id);
  });
  tx();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- tests/lib/queries/bins.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "feat(queries): bins tree + note_bins + merge"
```

---

### Task 10: Extend sync-status queries for cursor

**Files:**
- Modify: `lib/queries/sync-status.ts`
- Modify: `tests/lib/queries/sync-status.test.ts`

- [ ] **Step 1: Add a failing test for cursor read/write**

Append to `tests/lib/queries/sync-status.test.ts` (inside the existing `describe`):

```typescript
  it("recordSyncRun persists and reads a cursor", () => {
    recordSyncRun({ sync_name: "notion", status: "ok", cursor: '{"db1":"2026-04-23T00:00:00Z"}' });
    const status = readSyncCursor("notion");
    expect(status).toBe('{"db1":"2026-04-23T00:00:00Z"}');
  });

  it("readSyncCursor returns null when no row exists", () => {
    expect(readSyncCursor("never-ran")).toBeNull();
  });
```

And add `readSyncCursor` to the import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/lib/queries/sync-status.test.ts
```

Expected: FAIL — `readSyncCursor` not exported; `recordSyncRun` doesn't accept `cursor`.

- [ ] **Step 3: Update the implementation**

Replace `lib/queries/sync-status.ts` with:

```typescript
import { getDb } from "../db";
import { nowIso } from "../utils";
import type { SyncStatusRecord, SyncStatus } from "../types";

export function recordSyncRun(input: {
  sync_name: string;
  status: SyncStatus;
  error_message?: string | null;
  duration_ms?: number | null;
  cursor?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_status (sync_name, last_run_at, status, error_message, duration_ms, cursor)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sync_name) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       status = excluded.status,
       error_message = excluded.error_message,
       duration_ms = excluded.duration_ms,
       cursor = COALESCE(excluded.cursor, sync_status.cursor)`
  ).run(
    input.sync_name,
    nowIso(),
    input.status,
    input.error_message ?? null,
    input.duration_ms ?? null,
    input.cursor ?? null
  );
}

export function readSyncCursor(sync_name: string): string | null {
  const row = getDb()
    .prepare("SELECT cursor FROM sync_status WHERE sync_name = ?")
    .get(sync_name) as { cursor: string | null } | undefined;
  return row?.cursor ?? null;
}

export function listSyncStatuses(): SyncStatusRecord[] {
  return getDb().prepare("SELECT * FROM sync_status ORDER BY sync_name ASC").all() as SyncStatusRecord[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- tests/lib/queries/sync-status.test.ts
```

Expected: all sync-status tests pass (including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/queries/sync-status.ts tests/lib/queries/sync-status.test.ts
git commit -m "feat(sync-status): cursor read/write for resumable delta sync"
```

---

### Task 11: Create test fixture vault

**Files:**
- Create: `tests/fixtures/vault/notes/alpha.md`
- Create: `tests/fixtures/vault/notes/beta.md`
- Create: `tests/fixtures/vault/captures/2026-04-23-10-00-sample.md`
- Create: `tests/fixtures/vault/.obsidian/config.json` (dummy)

- [ ] **Step 1: Create the fixture directory and files**

Run:
```bash
mkdir -p tests/fixtures/vault/notes tests/fixtures/vault/captures tests/fixtures/vault/.obsidian
```

- [ ] **Step 2: Write `tests/fixtures/vault/notes/alpha.md`:**

```markdown
---
tags: [reels, tokyo]
bins: [auto-seed-reels]
---
# Alpha Reel Idea

This is a thought about a Tokyo reel. #travel
```

- [ ] **Step 3: Write `tests/fixtures/vault/notes/beta.md`:**

```markdown
# Beta Thoughts

Some unstructured thinking about client work. No frontmatter at all.
```

- [ ] **Step 4: Write `tests/fixtures/vault/captures/2026-04-23-10-00-sample.md`:**

```markdown
---
source: capture
created_at: 2026-04-23T10:00:00Z
bins: [seeded-captures]
tags: [quick]
---
This is a quick captured thought.
```

- [ ] **Step 5: Write a minimal `.obsidian/config.json` so our "ignore .obsidian" logic gets exercised:**

```json
{ "dummy": true }
```

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/vault/
git commit -m "test: add fixture vault with notes, captures, and .obsidian noise"
```

---

### Task 12: Vault indexer script (with tests)

**Files:**
- Create: `scripts/vault-indexer.ts`
- Create: `tests/scripts/vault-indexer.test.ts`

The indexer does a full vault scan, hashes file contents, upserts `vault_notes` rows, manages the FTS index, and seeds `note_bins` from frontmatter on first-seen files. Supports `--vault <path>` and `--file <relative-path>` flags.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/vault-indexer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runVaultIndexer } from "../../scripts/vault-indexer";
import { listVaultNotes, searchVaultNotes, getVaultNoteByPath } from "../../lib/queries/vault-notes";
import { listBins, createBin, listBinsForNote, getOrCreateBinBySeed } from "../../lib/queries/bins";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-vault-indexer.db");
const FIXTURE_VAULT = path.join(process.cwd(), "tests", "fixtures", "vault");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("vault-indexer", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("indexes all markdown files in the vault and skips .obsidian", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const paths = notes.map((n) => n.vault_path).sort();
    expect(paths).toEqual([
      "captures/2026-04-23-10-00-sample.md",
      "notes/alpha.md",
      "notes/beta.md",
    ]);
  });

  it("extracts title from frontmatter > heading > filename", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    expect(getVaultNoteByPath("notes/alpha.md")?.title).toBe("Alpha Reel Idea");
    expect(getVaultNoteByPath("notes/beta.md")?.title).toBe("Beta Thoughts");
  });

  it("indexes content into FTS5 and search works", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const hits = searchVaultNotes("tokyo");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].note.vault_path).toBe("notes/alpha.md");
  });

  it("creates note_bins from frontmatter bins on first index only", async () => {
    const bin = getOrCreateBinBySeed({ source_seed: "auto-seed-reels", name: "Reels" });
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const alpha = getVaultNoteByPath("notes/alpha.md")!;
    expect(listBinsForNote(alpha.id).map((b) => b.id)).toContain(bin.id);
  });

  it("does NOT re-seed note_bins on re-index", async () => {
    const bin = getOrCreateBinBySeed({ source_seed: "auto-seed-reels", name: "Reels" });
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const alpha = getVaultNoteByPath("notes/alpha.md")!;
    // simulate manual removal
    const manualBin = createBin({ name: "Manual" });
    const { unassignNoteFromBin, assignNoteToBin } = await import("../../lib/queries/bins");
    unassignNoteFromBin(alpha.id, bin.id);
    assignNoteToBin({ note_id: alpha.id, bin_id: manualBin.id, assigned_by: "manual" });
    // re-index
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const binsNow = listBinsForNote(alpha.id).map((b) => b.id);
    expect(binsNow).toContain(manualBin.id);
    expect(binsNow).not.toContain(bin.id);
  });

  it("--file mode indexes only the named file", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT, filePath: "notes/alpha.md" });
    const notes = listVaultNotes(100);
    expect(notes).toHaveLength(1);
    expect(notes[0].vault_path).toBe("notes/alpha.md");
  });

  it("skips unchanged files on second run (content_hash hit)", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const firstAlpha = getVaultNoteByPath("notes/alpha.md")!;
    const firstIndexedAt = firstAlpha.last_indexed_at;
    // tiny sleep to ensure timestamps would differ
    await new Promise((r) => setTimeout(r, 10));
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const secondAlpha = getVaultNoteByPath("notes/alpha.md")!;
    expect(secondAlpha.content_hash).toBe(firstAlpha.content_hash);
  });

  it("soft-deletes notes whose files disappear, hard-deletes on next scan if still missing", async () => {
    // Use a scratch vault so we can delete files
    const scratch = path.join(process.cwd(), "tests", "fixtures", "scratch-vault");
    fs.mkdirSync(path.join(scratch, "notes"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "notes", "temp.md"), "# Temp\nhello");
    await runVaultIndexer({ vaultPath: scratch });
    const note = getVaultNoteByPath("notes/temp.md")!;
    expect(note).toBeTruthy();
    fs.unlinkSync(path.join(scratch, "notes", "temp.md"));
    await runVaultIndexer({ vaultPath: scratch });
    const afterSoft = listVaultNotes(100);
    expect(afterSoft).toHaveLength(0); // listVaultNotes filters deleted
    await runVaultIndexer({ vaultPath: scratch });
    // Still nothing in active list; also confirm it's hard-deleted
    const { getVaultNoteById } = await import("../../lib/queries/vault-notes");
    expect(getVaultNoteById(note.id)).toBeNull();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/scripts/vault-indexer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/vault-indexer.ts`:

```typescript
import fastGlob from "fast-glob";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db";
import { nowIso } from "../lib/utils";
import { hashContent } from "../lib/vault/hash";
import { parseFrontmatter, extractInlineTags } from "../lib/vault/frontmatter";
import { markdownToPlainText, deriveTitle } from "../lib/vault/markdown";
import {
  upsertVaultNote,
  getVaultNoteByPath,
  getVaultNoteById,
  updateFtsRow,
  softDeleteVaultNote,
  hardDeleteVaultNote,
  listAllIndexedPaths,
} from "../lib/queries/vault-notes";
import { assignNoteToBin } from "../lib/queries/bins";
import { recordSyncRun } from "../lib/queries/sync-status";
import type { VaultNoteSource } from "../lib/types";

const IGNORE_GLOBS = ["**/.obsidian/**", "**/.trash/**", "**/.git/**", "**/node_modules/**", "**/*.icloud"];

export interface RunOptions {
  vaultPath: string;
  filePath?: string;         // relative to vaultPath — single-file mode
}

export async function runVaultIndexer(opts: RunOptions): Promise<void> {
  const started = Date.now();
  const db = getDb();

  const vaultAbs = path.resolve(opts.vaultPath);
  if (!fs.existsSync(vaultAbs)) {
    throw new Error(`vault path does not exist: ${vaultAbs}`);
  }

  const relativePaths = opts.filePath
    ? [opts.filePath]
    : await fastGlob("**/*.md", { cwd: vaultAbs, ignore: IGNORE_GLOBS, dot: false });

  const seenPaths = new Set<string>();

  for (const rel of relativePaths) {
    const abs = path.join(vaultAbs, rel);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    const raw = fs.readFileSync(abs, "utf-8");
    const hash = hashContent(raw);
    const existing = getVaultNoteByPath(rel);
    seenPaths.add(rel);

    if (existing && existing.content_hash === hash && existing.deleted_at === null) {
      // No content change — touch last_indexed_at only
      db.prepare("UPDATE vault_notes SET last_indexed_at = ?, modified_at = ? WHERE id = ?")
        .run(nowIso(), stat.mtime.toISOString(), existing.id);
      continue;
    }

    const { data: frontmatter, body } = parseFrontmatter(raw);
    const title = deriveTitle(frontmatter, body, rel);
    const source: VaultNoteSource =
      (typeof frontmatter.source === "string" && ["notion", "obsidian", "capture", "apple-notes"].includes(frontmatter.source))
        ? (frontmatter.source as VaultNoteSource)
        : rel.startsWith("notion-sync/")
        ? "notion"
        : rel.startsWith("captures/")
        ? "capture"
        : "obsidian";
    const source_id = typeof frontmatter.source_id === "string" ? frontmatter.source_id : null;
    const source_url = typeof frontmatter.source_url === "string" ? frontmatter.source_url : null;

    const note = upsertVaultNote({
      vault_path: rel,
      title,
      source,
      source_id,
      source_url,
      content_hash: hash,
      modified_at: stat.mtime.toISOString(),
      created_at:
        typeof frontmatter.created_at === "string" ? frontmatter.created_at : stat.birthtime.toISOString(),
    });

    // Refresh FTS
    const plainText = markdownToPlainText(body);
    const fmTags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
    const inlineTags = extractInlineTags(body);
    const allTags = Array.from(new Set([...fmTags, ...inlineTags]));
    updateFtsRow({
      note_id: note.id,
      title,
      plain_text: plainText,
      tags: allTags.join(" "),
    });

    // Refresh note_tags table
    db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(note.id);
    const insertTag = db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)");
    for (const tag of allTags) insertTag.run(note.id, tag);

    // Seed bins from frontmatter — ONLY on first index of this file
    const isFirstIndex = existing === null;
    if (isFirstIndex && Array.isArray(frontmatter.bins)) {
      for (const binId of frontmatter.bins as unknown[]) {
        if (typeof binId === "string") {
          const binExists = db.prepare("SELECT 1 FROM bins WHERE id = ?").get(binId);
          if (binExists) {
            assignNoteToBin({ note_id: note.id, bin_id: binId, assigned_by: "auto" });
          }
        }
      }
    }
  }

  // Deletion handling (only in full-scan mode)
  if (!opts.filePath) {
    const indexedPaths = new Set(listAllIndexedPaths());
    for (const indexedPath of indexedPaths) {
      if (!seenPaths.has(indexedPath)) {
        const existing = getVaultNoteByPath(indexedPath);
        if (!existing) continue;
        if (existing.deleted_at === null) {
          softDeleteVaultNote(existing.id);
        } else {
          hardDeleteVaultNote(existing.id);
        }
      }
    }
  }

  recordSyncRun({
    sync_name: "vault-indexer",
    status: "ok",
    duration_ms: Date.now() - started,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  const fileIdx = args.indexOf("--file");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
  try {
    await runVaultIndexer({ vaultPath, filePath });
    console.log(`[vault-indexer] ok ${filePath ? `(file: ${filePath})` : ""}`);
  } catch (err) {
    console.error("[vault-indexer] error:", err);
    recordSyncRun({
      sync_name: "vault-indexer",
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

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- tests/scripts/vault-indexer.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Add npm script**

Modify `package.json` — add to the `scripts` section:

```json
    "sync:vault": "tsx scripts/vault-indexer.ts",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/vault-indexer.ts tests/scripts/vault-indexer.test.ts package.json
git commit -m "feat(scripts): cron-driven vault indexer with FTS + bin seed on first index"
```

---

### Task 13: Sync-obsidian script (seed + bin auto-creation)

**Files:**
- Create: `scripts/sync-obsidian.ts`
- Create: `tests/scripts/sync-obsidian.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/sync-obsidian.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runSyncObsidian } from "../../scripts/sync-obsidian";
import { listVaultNotes } from "../../lib/queries/vault-notes";
import { listBins, listBinsForNote, getBinBySeed } from "../../lib/queries/bins";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-obsidian.db");
const FIXTURE_VAULT = path.join(process.cwd(), "tests", "fixtures", "vault");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("sync-obsidian", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("creates bins for each top-level folder under notes/", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    expect(getBinBySeed("obsidian:notes")).toBeTruthy();
    expect(getBinBySeed("obsidian:captures")).toBeTruthy();
  });

  it("assigns notes to the matching auto-bin by folder", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const alpha = notes.find((n) => n.vault_path === "notes/alpha.md")!;
    const bin = getBinBySeed("obsidian:notes")!;
    expect(listBinsForNote(alpha.id).map((b) => b.id)).toContain(bin.id);
  });

  it("is idempotent on re-run (no duplicate bins, no duplicate assignments)", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const binsAfterFirst = listBins().length;
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const binsAfterSecond = listBins().length;
    expect(binsAfterSecond).toBe(binsAfterFirst);
  });

  it("preserves manual bin assignments on re-run", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const alpha = notes.find((n) => n.vault_path === "notes/alpha.md")!;
    const autoBin = getBinBySeed("obsidian:notes")!;
    // Simulate manual removal of the auto-bin
    const { unassignNoteFromBin } = await import("../../lib/queries/bins");
    unassignNoteFromBin(alpha.id, autoBin.id);
    // Re-run
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    // The removal should be preserved — we don't re-add the auto assignment
    expect(listBinsForNote(alpha.id).map((b) => b.id)).not.toContain(autoBin.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- tests/scripts/sync-obsidian.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/sync-obsidian.ts`:

```typescript
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db";
import { runVaultIndexer } from "./vault-indexer";
import { getOrCreateBinBySeed, assignNoteToBin } from "../lib/queries/bins";
import { listVaultNotes } from "../lib/queries/vault-notes";
import { recordSyncRun } from "../lib/queries/sync-status";

const IGNORE_TOP_LEVEL = new Set([".obsidian", ".trash", ".git", "node_modules", "_meta"]);

export interface SyncObsidianOptions {
  vaultPath: string;
}

export async function runSyncObsidian(opts: SyncObsidianOptions): Promise<void> {
  const started = Date.now();
  const vaultAbs = path.resolve(opts.vaultPath);

  // Ensure all notes are indexed first
  await runVaultIndexer({ vaultPath: vaultAbs });

  const db = getDb();

  // Create a bin per top-level folder that contains markdown files
  const entries = fs.readdirSync(vaultAbs, { withFileTypes: true });
  const topLevelFolders = entries
    .filter((e) => e.isDirectory() && !IGNORE_TOP_LEVEL.has(e.name))
    .map((e) => e.name);

  for (const folder of topLevelFolders) {
    getOrCreateBinBySeed({
      source_seed: `obsidian:${folder}`,
      name: capitalize(folder),
    });
  }

  // Assign existing notes to their folder's bin — only if the note currently has
  // no note_bins row with assigned_by='auto' for that bin already. This preserves
  // manual removals on re-run.
  const notes = listVaultNotes(10_000);
  for (const note of notes) {
    const topFolder = note.vault_path.split(path.sep)[0];
    if (!topFolder || IGNORE_TOP_LEVEL.has(topFolder)) continue;
    const bin = getOrCreateBinBySeed({
      source_seed: `obsidian:${topFolder}`,
      name: capitalize(topFolder),
    });
    const alreadyHad = db
      .prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?")
      .get(note.id, bin.id);
    const everHad = db
      .prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ? AND assigned_by = 'auto'")
      .get(note.id, bin.id);
    // Skip if already assigned OR if this auto-bin was previously assigned+removed.
    // We detect "previously assigned" via a small tracking table? No — simpler:
    // if the note has ANY note_bins rows, assume the user has curated it.
    const anyBins = db.prepare("SELECT COUNT(*) as n FROM note_bins WHERE note_id = ?").get(note.id) as { n: number };
    if (anyBins.n > 0 && !alreadyHad) continue; // user has curated; skip
    if (alreadyHad) continue;
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "auto" });
  }

  recordSyncRun({
    sync_name: "sync-obsidian",
    status: "ok",
    duration_ms: Date.now() - started,
  });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
  try {
    await runSyncObsidian({ vaultPath });
    console.log("[sync-obsidian] ok");
  } catch (err) {
    console.error("[sync-obsidian] error:", err);
    recordSyncRun({ sync_name: "sync-obsidian", status: "error", error_message: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- tests/scripts/sync-obsidian.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Add npm script**

Modify `package.json`:

```json
    "sync:obsidian": "tsx scripts/sync-obsidian.ts",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-obsidian.ts tests/scripts/sync-obsidian.test.ts package.json
git commit -m "feat(scripts): sync-obsidian seeds bins from top-level folders, preserves curation"
```

---

### Task 14: Update `/api/notes` (list endpoint)

**Files:**
- Modify: `app/api/notes/route.ts`

- [ ] **Step 1: Replace the file**

Overwrite `app/api/notes/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listVaultNotes, listVaultNotesByBin } from "@/lib/queries/vault-notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"), 200);
  const binId = searchParams.get("bin");

  const notes = binId ? listVaultNotesByBin(binId, limit) : listVaultNotes(limit);
  return NextResponse.json({ notes });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: the error for this file is resolved. Remaining errors are for `app/clients/[slug]/page.tsx`, `app/api/clients/[slug]/route.ts`, `app/notes/page.tsx` — fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add app/api/notes/route.ts
git commit -m "feat(api): /api/notes returns vault notes, filterable by bin"
```

---

### Task 15: Create `/api/notes/[id]` (detail endpoint)

**Files:**
- Create: `app/api/notes/[id]/route.ts`

This endpoint returns the note row, the raw markdown content read from disk, and the list of bins it's in.

- [ ] **Step 1: Write the file**

Create `app/api/notes/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVaultNoteById } from "@/lib/queries/vault-notes";
import { listBinsForNote } from "@/lib/queries/bins";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

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
```

- [ ] **Step 2: Commit**

```bash
git add app/api/notes/[id]/route.ts
git commit -m "feat(api): /api/notes/[id] returns note + file content + bins"
```

---

### Task 16: Create `/api/notes/search` (FTS endpoint)

**Files:**
- Create: `app/api/notes/search/route.ts`

- [ ] **Step 1: Write the file**

Create `app/api/notes/search/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { searchVaultNotes } from "@/lib/queries/vault-notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });
  const limit = parseLimit(searchParams.get("limit"), 50);

  // Sanitize: FTS5 special characters could be used as attack vectors.
  // Wrap in quotes for phrase match, escape inner quotes by doubling.
  const safeQuery = `"${q.replace(/"/g, '""')}"`;

  try {
    const hits = searchVaultNotes(safeQuery, limit);
    return NextResponse.json({ hits });
  } catch (err) {
    return NextResponse.json({ error: "search failed", detail: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/notes/search/route.ts
git commit -m "feat(api): /api/notes/search FTS5 endpoint with sanitized phrase match"
```

---

### Task 17: Create `/api/bins` (list + create)

**Files:**
- Create: `app/api/bins/route.ts`

- [ ] **Step 1: Write the file**

Create `app/api/bins/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listBinTree, createBin } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ bins: listBinTree() });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.name, 120)) return badRequest("name required (<=120 chars)");
  if (!isOptionalString(b.parent_bin_id, 32)) return badRequest("parent_bin_id must be string");
  const bin = createBin({
    name: b.name as string,
    parent_bin_id: (b.parent_bin_id as string | undefined) ?? null,
  });
  return NextResponse.json({ bin }, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/bins/route.ts
git commit -m "feat(api): /api/bins GET tree + POST create"
```

---

### Task 18: Create `/api/bins/[id]` (patch + delete)

**Files:**
- Create: `app/api/bins/[id]/route.ts`

- [ ] **Step 1: Write the file**

Create `app/api/bins/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getBinById, updateBin, deleteBin, mergeBin } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  // Merge operation is a special PATCH with a merge_into target
  if (typeof b.merge_into === "string") {
    const target = getBinById(b.merge_into);
    if (!target) return badRequest("merge_into target not found");
    mergeBin(params.id, b.merge_into);
    return NextResponse.json({ merged_into: b.merge_into });
  }

  if (b.name !== undefined && !isNonEmptyString(b.name, 120)) return badRequest("name must be non-empty string (<=120)");
  if (!isOptionalString(b.parent_bin_id, 32)) return badRequest("parent_bin_id must be string");
  if (b.sort_order !== undefined && typeof b.sort_order !== "number") return badRequest("sort_order must be number");

  const updated = updateBin(params.id, {
    name: b.name as string | undefined,
    parent_bin_id: b.parent_bin_id === undefined ? undefined : (b.parent_bin_id as string | null),
    sort_order: b.sort_order as number | undefined,
  });
  return NextResponse.json({ bin: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteBin(params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/bins/[id]/route.ts
git commit -m "feat(api): /api/bins/[id] PATCH (incl. merge_into) + DELETE"
```

---

### Task 19: Create `/api/bins/[id]/assign` (POST) + unassign route

**Files:**
- Create: `app/api/bins/[id]/assign/route.ts`
- Create: `app/api/bins/[id]/assign/[noteId]/route.ts`

- [ ] **Step 1: Write the POST (assign) route**

Create `app/api/bins/[id]/assign/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { assignNoteToBin, getBinById } from "@/lib/queries/bins";
import { getVaultNoteById } from "@/lib/queries/vault-notes";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const bin = getBinById(params.id);
  if (!bin) return NextResponse.json({ error: "bin not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.note_id, 32)) return badRequest("note_id required");
  const note = getVaultNoteById(b.note_id as string);
  if (!note) return NextResponse.json({ error: "note not found" }, { status: 404 });
  assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the DELETE (unassign) route**

Create `app/api/bins/[id]/assign/[noteId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { unassignNoteFromBin } from "@/lib/queries/bins";

export async function DELETE(_req: Request, { params }: { params: { id: string; noteId: string } }) {
  unassignNoteFromBin(params.noteId, params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/bins/[id]/assign/
git commit -m "feat(api): assign/unassign notes to bins"
```

---

### Task 20: Update `/api/clients/[slug]` to use new query

**Files:**
- Modify: `app/api/clients/[slug]/route.ts`

- [ ] **Step 1: Update the import and call**

Replace the line:
```typescript
import { listNotesByClient } from "@/lib/queries/notes";
```
with:
```typescript
import { listVaultNotesByClient } from "@/lib/queries/vault-notes";
```

And in the `GET` handler, replace:
```typescript
    notes: listNotesByClient(client.id),
```
with:
```typescript
    notes: listVaultNotesByClient(client.id),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: this file's errors are resolved. Remaining errors are for `app/clients/[slug]/page.tsx` and `app/notes/page.tsx` — fixed next.

- [ ] **Step 3: Commit**

```bash
git add app/api/clients/[slug]/route.ts
git commit -m "refactor(api): clients endpoint uses listVaultNotesByClient"
```

---

### Task 21: Update client hub page to use new query

**Files:**
- Modify: `app/clients/[slug]/page.tsx`

- [ ] **Step 1: Update imports and calls**

Replace:
```typescript
import { listNotesByClient } from "@/lib/queries/notes";
```
with:
```typescript
import { listVaultNotesByClient } from "@/lib/queries/vault-notes";
```

Replace:
```typescript
  const notes = listNotesByClient(client.id, 5);
```
with:
```typescript
  const notes = listVaultNotesByClient(client.id, 5);
```

In the Notes card section, replace the fields that reference `n.content_preview`, `n.source.replace("_", " ")`:

Old:
```tsx
              {notes.map((n) => (
                <div key={n.id} className="bg-base rounded p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs text-text-primary font-medium">{n.title}</span>
                    <span className="text-[9px] bg-hover px-1.5 py-0.5 rounded-sm text-text-muted capitalize">
                      {n.source.replace("_", " ")}
                    </span>
                  </div>
                  {n.content_preview && (
                    <div className="text-[10px] text-text-secondary line-clamp-2">{n.content_preview}</div>
                  )}
                </div>
              ))}
```

New:
```tsx
              {notes.map((n) => (
                <a key={n.id} href={`/notes/${n.id}`} className="block bg-base rounded p-2.5 hover:bg-hover">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs text-text-primary font-medium">{n.title}</span>
                    <span className="text-[9px] bg-hover px-1.5 py-0.5 rounded-sm text-text-muted capitalize">
                      {n.source}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted mono">
                    {n.vault_path}
                  </div>
                </a>
              ))}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: this file's errors are resolved. Remaining error: `app/notes/page.tsx` — fixed next.

- [ ] **Step 3: Commit**

```bash
git add app/clients/[slug]/page.tsx
git commit -m "refactor(client hub): notes card uses vault_notes + links to detail page"
```

---

### Task 22: `BinTree` component

**Files:**
- Create: `components/BinTree.tsx`

- [ ] **Step 1: Write the component**

Create `components/BinTree.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { BinNode } from "@/lib/types";

interface Props {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
}

export function BinTree({ bins, selectedBinId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <button
        onClick={() => onSelect(null)}
        className={`text-left px-2 py-1 rounded ${selectedBinId === null ? "bg-hover text-text-primary" : "text-text-muted hover:bg-hover/50"}`}
      >
        All notes
      </button>
      {bins.length === 0 ? (
        <div className="text-text-muted px-2 py-1 text-[10px]">
          No bins yet. Run Settings → Initial vault scan.
        </div>
      ) : (
        bins.map((bin) => (
          <BinNodeRow key={bin.id} node={bin} depth={0} selectedBinId={selectedBinId} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}

function BinNodeRow({
  node,
  depth,
  selectedBinId,
  onSelect,
}: {
  node: BinNode;
  depth: number;
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedBinId;
  return (
    <div>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-text-muted hover:text-text-primary w-4 text-[10px] shrink-0"
            aria-label={expanded ? "collapse" : "expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${depth * 8}px` }}
          className={`flex-1 text-left px-2 py-1 rounded ${isSelected ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover/50"}`}
        >
          {node.name}{" "}
          <span className="text-text-muted text-[10px]">({node.note_count})</span>
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <BinNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedBinId={selectedBinId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BinTree.tsx
git commit -m "feat(ui): BinTree component with expand/collapse + note counts"
```

---

### Task 23: `NoteList` component

**Files:**
- Create: `components/NoteList.tsx`

- [ ] **Step 1: Write the component**

Create `components/NoteList.tsx`:

```typescript
import Link from "next/link";
import type { VaultNote } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { Badge } from "./Badge";

const sourceLabels: Record<VaultNote["source"], string> = {
  obsidian: "Obsidian",
  notion: "Notion",
  capture: "Capture",
  "apple-notes": "Apple Notes",
};

interface Props {
  notes: VaultNote[];
  emptyMessage?: string;
}

export function NoteList({ notes, emptyMessage = "No notes in this view." }: Props) {
  if (notes.length === 0) {
    return <p className="text-xs text-text-muted px-2 py-6">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-hover">
      {notes.map((n) => (
        <Link
          key={n.id}
          href={`/notes/${n.id}`}
          className="flex items-start justify-between gap-3 px-2 py-2.5 hover:bg-hover/40"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs text-text-primary font-medium truncate">{n.title}</span>
              <Badge>{sourceLabels[n.source]}</Badge>
            </div>
            <div className="text-[10px] text-text-muted mono truncate">{n.vault_path}</div>
          </div>
          <div className="text-[10px] text-text-muted mono shrink-0">
            {formatRelativeTime(n.modified_at)}
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/NoteList.tsx
git commit -m "feat(ui): NoteList component with source chips + linked rows"
```

---

### Task 24: `SearchBar` component

**Files:**
- Create: `components/SearchBar.tsx`

- [ ] **Step 1: Write the component**

Create `components/SearchBar.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { VaultNoteSearchHit } from "@/lib/types";

interface Props {
  onSelectHit?: (hit: VaultNoteSearchHit) => void;
}

export function SearchBar({ onSelectHit }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VaultNoteSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/notes/search?q=${encodeURIComponent(query)}&limit=15`);
        const data = await res.json();
        setHits(data.hits ?? []);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search notes…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="w-full bg-base border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-green focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-lg max-h-80 overflow-auto z-50">
          {loading && <div className="px-3 py-2 text-[10px] text-text-muted">Searching…</div>}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-text-muted">No matches.</div>
          )}
          {hits.map((hit) => (
            <a
              key={hit.note.id}
              href={`/notes/${hit.note.id}`}
              onClick={() => onSelectHit?.(hit)}
              className="block px-3 py-2 hover:bg-hover border-b border-hover last:border-0"
            >
              <div className="text-xs text-text-primary font-medium">{hit.note.title}</div>
              <div
                className="text-[10px] text-text-secondary line-clamp-2 mt-0.5"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/SearchBar.tsx
git commit -m "feat(ui): SearchBar with debounced FTS5 queries + snippet rendering"
```

---

### Task 25: Rewrite `/notes` page (bin browser)

**Files:**
- Modify: `app/notes/page.tsx`

- [ ] **Step 1: Overwrite the file**

Replace `app/notes/page.tsx` with:

```typescript
"use client";

import { useEffect, useState } from "react";
import { BinTree } from "@/components/BinTree";
import { NoteList } from "@/components/NoteList";
import { SearchBar } from "@/components/SearchBar";
import type { BinNode, VaultNote } from "@/lib/types";

export default function NotesPage() {
  const [bins, setBins] = useState<BinNode[]>([]);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => setBins(d.bins ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = selectedBinId
      ? `/api/notes?bin=${encodeURIComponent(selectedBinId)}&limit=200`
      : "/api/notes?limit=200";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .finally(() => setLoading(false));
  }, [selectedBinId]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="mono text-lg font-semibold text-text-primary">Notes</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading ? "Loading…" : `${notes.length} notes${selectedBinId ? " in selected bin" : ""}`}
          </p>
        </div>
        <div className="w-80">
          <SearchBar />
        </div>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <aside className="bg-card border border-border rounded p-2 h-fit">
          <BinTree bins={bins} selectedBinId={selectedBinId} onSelect={setSelectedBinId} />
        </aside>
        <main className="bg-card border border-border rounded">
          <NoteList notes={notes} emptyMessage={selectedBinId ? "No notes in this bin." : "No notes yet. Run Settings → Initial vault scan."} />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: clean — no errors.

- [ ] **Step 3: Commit**

```bash
git add app/notes/page.tsx
git commit -m "feat(ui): /notes rebuilt as bin browser + search (replaces old flat list)"
```

---

### Task 26: `/notes/[id]` detail page

**Files:**
- Create: `app/notes/[id]/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/notes/[id]/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardHeader } from "@/components/Card";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Badge } from "@/components/Badge";
import { formatRelativeTime } from "@/lib/utils";
import type { VaultNote, Bin } from "@/lib/types";

interface NoteDetail {
  note: VaultNote;
  content: string;
  bins: Bin[];
}

export default function NoteDetailPage({ params }: { params: { id: string } }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    fetch(`/api/notes/${params.id}`)
      .then(async (r) => {
        if (r.status === 404) {
          setStatus("missing");
          return;
        }
        if (!r.ok) {
          setStatus("error");
          return;
        }
        const data = (await r.json()) as NoteDetail;
        setDetail(data);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [params.id]);

  if (status === "missing") notFound();
  if (status === "loading" || !detail) {
    return <div className="text-xs text-text-muted">Loading note…</div>;
  }
  if (status === "error") {
    return <div className="text-xs text-red-400">Could not load this note.</div>;
  }

  const { note, content, bins } = detail;
  const frontmatterSplit = content.split(/^---\s*$/m);
  const body = frontmatterSplit.length >= 3 ? frontmatterSplit.slice(2).join("---").trim() : content;

  return (
    <div>
      <Breadcrumb items={[{ label: "Notes", href: "/notes" }, { label: note.title }]} />

      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="mono text-lg font-semibold text-text-primary">{note.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge>{note.source}</Badge>
            <span className="text-[10px] text-text-muted mono">{note.vault_path}</span>
            <span className="text-[10px] text-text-muted">·</span>
            <span className="text-[10px] text-text-muted">{formatRelativeTime(note.modified_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {note.source_url && (
            <a
              href={note.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] mono border border-border rounded px-2 py-1 hover:bg-hover"
            >
              Open in {note.source}
            </a>
          )}
          <a
            href={`obsidian://open?path=${encodeURIComponent(note.vault_path)}`}
            className="text-[10px] mono border border-border rounded px-2 py-1 hover:bg-hover"
          >
            Open in Obsidian
          </a>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-4">
        <Card>
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </Card>
        <aside className="flex flex-col gap-3">
          <Card>
            <CardHeader label="In bins" />
            {bins.length === 0 ? (
              <p className="text-xs text-text-muted">Not assigned to any bin.</p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {bins.map((b) => (
                  <li key={b.id} className="text-[10px] bg-hover px-2 py-1 rounded">
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-text-muted mt-3">
              Bin membership is managed here. Edits to the `bins:` frontmatter field in the file have no effect after initial creation.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/notes/[id]/page.tsx
git commit -m "feat(ui): /notes/[id] detail page with react-markdown + bin panel"
```

---

### Task 27: Run full test suite

**Files:** none.

- [ ] **Step 1: Run the entire test suite**

Run:
```bash
npm test
```

Expected: all tests pass. Baseline was 40 before this plan; new baseline should be ~85+ (roughly 40 existing + 45 new across vault utils, queries, and scripts). No failures.

- [ ] **Step 2: Run linter**

Run:
```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Run production build**

Run:
```bash
npm run build
```

Expected: clean build — all pages and API routes compile. Note any warnings.

- [ ] **Step 4: Commit nothing (just a checkpoint)**

If everything is green, the plan is complete. If anything fails, fix it inline and continue.

---

### Task 28: Manual end-to-end smoke test

**Files:** none.

This is a required verification step. The UI cannot be unit-tested meaningfully; this is where the feature is actually validated.

- [ ] **Step 1: Set up a real vault**

Run:
```bash
mkdir -p ~/Vault/notes ~/Vault/captures
cat > ~/Vault/notes/example.md <<'EOF'
---
tags: [testing]
---
# Example Note

This is a test note for the Thought Organizer with a #demo tag.

Some **bold** text and a [[Wikilink]] reference.
EOF
```

- [ ] **Step 2: Seed the vault and bins**

Run:
```bash
VAULT_PATH=~/Vault npm run sync:obsidian
```

Expected: `[sync-obsidian] ok`.

- [ ] **Step 3: Verify DB state**

Run:
```bash
sqlite3 data/dashboard.db "SELECT vault_path, title, source FROM vault_notes;"
sqlite3 data/dashboard.db "SELECT name, source_seed FROM bins;"
```

Expected:
- `notes/example.md|Example Note|obsidian`
- at least one bin row with `source_seed = 'obsidian:notes'`

- [ ] **Step 4: Start the dev server and verify the UI**

Run:
```bash
VAULT_PATH=~/Vault npm run dev
```

Open `http://localhost:3000/notes` in a browser. Verify:
- Left sidebar shows the Notes bin with note count `(1)`
- Clicking the bin filters to show `Example Note`
- The search bar finds the note when typing `demo` or `example`
- Clicking the note opens `/notes/[id]` and renders the markdown with `# Example Note` as a heading, `bold` bolded, and the tag visible
- The "Open in Obsidian" button generates a URL that starts with `obsidian://`

- [ ] **Step 5: Test FTS search across content**

In the UI search bar, type `wikilink` (lowercase). Expected: the note appears in the dropdown with a snippet highlighting the match.

- [ ] **Step 6: Test soft-delete and re-index**

Run:
```bash
rm ~/Vault/notes/example.md
VAULT_PATH=~/Vault npm run sync:vault
```

Refresh the dashboard. Expected: the note no longer appears. Re-run `npm run sync:vault` again — the note should be hard-deleted from the DB.

- [ ] **Step 7: Test client linkage (regression)**

Visit `/clients` and navigate to any client detail page. Expected: the Notes card renders without errors (empty or with linked notes).

- [ ] **Step 8: Final commit**

No file changes needed — this is the verification checkpoint. If everything is green, the Phase 1 foundation is shippable.

```bash
git log --oneline | head -30
```

Expected: clean commit history for the plan.

---

## Post-Plan Checklist

Before calling this done, confirm:

- [ ] All automated tests pass (`npm test`)
- [ ] Lint clean (`npm run lint`)
- [ ] Build clean (`npm run build`)
- [ ] Manual smoke test passed in a browser
- [ ] `data/dashboard.db` has real vault_notes rows and bins after `sync:obsidian`
- [ ] `/notes` loads, bin tree works, search returns results
- [ ] `/notes/[id]` renders markdown
- [ ] No references to the old `notes` table anywhere in codebase: `grep -rn "from.*queries/notes\|listNotes\|listNotesByClient\|Note,\|NoteSource" app lib components`

If any of the above fails, fix inline and re-run the test suite.

---

## Self-Review

**Spec coverage (§ numbers refer to the spec):**

- §1 Problem & Motivation — addressed by the whole plan
- §2.1 Vault — Task 28 sets up the real vault; Tasks 11–13 exercise it in tests
- §2.2 Dashboard (viewport + metadata) — Tasks 17–27 build the UI and API
- §2.3 Agent layer (v3 prep) — frontmatter convention is preserved by the indexer (Task 12); not built yet (deferred)
- §3.1 Vault structure — honored by indexer's source inference from path prefix
- §3.2 Schema — Task 2
- §3.3 Migration files list — Tasks 7, 14, 20, 21
- §3.4 Not-in-SQLite — honored (content stays in files)
- §4.1 Indexer — Task 12
- §4.2 Notion sync — **deferred to Phase 2 plan** (noted in intro)
- §4.3 sync-obsidian — Task 13
- §4.4 Auth — Notion token setup is Phase 2
- §5.1 Modified pages — Task 25 (/notes)
- §5.2 New pages — Task 26 (/notes/[id])
- §5.3 Components — Tasks 22, 23, 24 (BinTree, NoteList, SearchBar)
- §5.4 Settings page additions — **deferred to Phase 2 plan**
- §5.5 Dependencies — Task 1
- §6 Capture flow — **deferred to Phase 2 plan**
- §7.1 Search — Task 8 (searchVaultNotes), Task 16 (API), Task 24 (UI)
- §7.2 Bin operations — Task 9 (queries), Tasks 17–19 (API)
- §7.3 Frontmatter invariant — Task 12 (indexer logic: "first index only")
- §7.4 Bin merging — Task 9 (mergeBin), Task 18 (API with merge_into)
- §8 Review surface — **deferred to Phase 2 plan**
- §9 Agent integration points — vault path discoverable + API exposes structured data via existing endpoints (done implicitly)
- §11 Deferred to v2+ — matches this plan's scope
- §12 Risks — addressed as tasks where they're actionable (Task 12 soft-delete handles indexer drift, Task 20 uses COALESCE to prevent overwrites)

Gaps requiring deferral to Phase 2 plan (already called out in the intro): Notion sync, Quick Capture, Settings additions, `/review` page. All explicitly out of Phase 1 scope — consistent with the spec's phase boundaries.

**Placeholder scan:** no "TBD" / "implement later" / "similar to Task N" / vague handling language found. Every code step contains full code.

**Type consistency check:**
- `VaultNote` interface: used in Tasks 3, 8, 12, 21, 23, 25, 26 — fields consistent (no renames across tasks)
- `Bin` vs `BinNode`: distinguished cleanly — `Bin` is the raw row, `BinNode` is the tree node with children+count. Used consistently in Tasks 9, 17, 22, 25
- `VaultNoteSearchHit`: defined in Task 3, returned from Task 8 `searchVaultNotes`, rendered in Task 24 — consistent
- `AssignedBy`: `'auto' | 'manual' | 'agent'` — consistent across Tasks 3, 9, 12, 13, 19
- Function names: `upsertVaultNote`, `listVaultNotesByClient`, `searchVaultNotes`, `assignNoteToBin`, `mergeBin`, `getOrCreateBinBySeed` — all used consistently between where they're defined and where they're called

No inconsistencies found.
