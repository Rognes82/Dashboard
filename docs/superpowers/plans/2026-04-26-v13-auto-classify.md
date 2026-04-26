# v1.3 Whole-note Auto-Classify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-powered classifier that places uncategorized notes into the user's bin tree on cron + manual trigger, surfaces pending decisions and recent auto-classifications in `/review`, with configurable thresholds and a settings-driven model profile.

**Architecture:** Standalone classifier process (`scripts/agent-classify.ts`) reads unbinned notes, calls an LLM via the existing multi-profile system, decides via threshold gates (auto-assign at confidence ≥ 0.6; auto-create-bin at rating ≥ 0.75 + margin ≥ 0.3), commits via the new `classification_proposals` / `classification_log` / `classifier_runs` tables. Concurrency 3 + 45 RPM token bucket. Race-free across processes via `BEGIN IMMEDIATE` writer-lock + orphan-row sweep. New migration runner in `lib/db.ts` (track via `PRAGMA user_version`) plus `migrations/001-classifier.sql` for schema additions.

**Tech Stack:** Next.js 14, better-sqlite3 v12.8.0 (WAL mode), Anthropic SDK + OpenAI-compatible SDK (existing v1.2 LLM abstraction), zod (newly added direct dep), p-limit (already in tree via `sync-notion.ts`), vitest for tests, gray-matter for frontmatter (existing).

**Spec:** `docs/superpowers/specs/2026-04-26-v13-auto-classify-design.md` (commit `cb91367`).

**Branch:** `feature/v1.3-auto-classify` (created from `main` at execution start).

---

## Codebase pre-flight notes (read before any task)

These assumptions are baked into the plan but worth confirming once before you start:

1. **`vault_notes` schema is metadata-only.** Columns: `id, vault_path, title, source, source_id, source_url, content_hash, created_at, modified_at, last_indexed_at, deleted_at, client_id, project_id`. There is NO `frontmatter`, `plain_text`, `excerpt`, `word_count`, or `tags` column. Content lives in FTS5 (a separate table) and on disk under `$VAULT_PATH/vault_path`.

2. **`upsertVaultNote(input)` does NOT take an `id`.** It generates a ULID internally and returns the full `VaultNote` row — capture `result.id`. The input shape is `{ vault_path, title, source, source_id, source_url, content_hash, modified_at, created_at?, client_id?, project_id? }`. When you need to seed a test note with a known id, capture the returned id and use it in subsequent assertions. Adapt the `seedNote` helpers in this plan's tests accordingly — they show the intent, not the literal signature.

3. **`createBin(input)` does NOT take an `id` or `created_at`.** Signature: `{ name, parent_bin_id?, source_seed?, sort_order? }`. Returns the full `Bin`. Capture `result.id` for subsequent calls.

4. **`assignNoteToBin({ note_id, bin_id, assigned_by })`** — `assigned_by` is one of `'auto' | 'manual' | 'agent'`. Use `'agent'` for classifier-driven assignments.

5. **`LlmProfile` shape:** `{ id, name, type, api_key_encrypted, base_url?, default_model, max_context_tokens, created_at }`. Fields `provider`, `model`, `updated_at` from earlier drafts of this plan don't exist — use `type`, `default_model`, omit `updated_at`.

6. **LLM key access:** `getProfileSecret(id)` returns the decrypted API key directly. Don't call `decryptSecret` yourself.

7. **Reading note content:** the classifier needs body + frontmatter, which aren't in the DB. Read from disk via `path.join(process.env.VAULT_PATH ?? path.join(process.env.HOME!, 'Vault'), note.vault_path)`, then parse with `gray-matter` (existing dep).

Confirm each by `grep`-ing the relevant file before locking in test code, and adapt as needed. The plan's test seed helpers express *intent* (which note exists, which bin exists, what's seeded); apply the actual signatures when typing them out.

---

## Pre-flight

- [ ] **Verify clean state:** on `main`, no uncommitted changes (other than `.gitignore` / DS_Store), tests green.

```bash
git status -s | grep -v "^??\|.gitignore"
npm test 2>&1 | tail -5
```

Expected: only `.gitignore` modified line; vitest reports `Tests passing` (currently 219).

- [ ] **Create feature branch from `main`:**

```bash
git checkout -b feature/v1.3-auto-classify
```

---

## Task 1: Add `zod` to direct dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install zod**

Run: `npm install zod@^3.23.8`

Expected: `package.json` `dependencies` gains `"zod": "^3.23.8"`; `package-lock.json` updated.

- [ ] **Step 2: Verify resolvable**

Run: `node -e "require.resolve('zod'); console.log('ok')"`

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(v1.3): add zod as direct dep for classifier output validation"
```

---

## Task 2: Migration runner in `lib/db.ts`

**Files:**
- Modify: `lib/db.ts`
- Create: `migrations/.gitkeep`
- Create: `tests/lib/db.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, migrate, getDb } from "../../lib/db";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-db-migrate.db");
const MIG_DIR = path.join(process.cwd(), "data", "test-migrations-tmp");

function setupMigrationsDir(files: Record<string, string>): void {
  if (fs.existsSync(MIG_DIR)) fs.rmSync(MIG_DIR, { recursive: true });
  fs.mkdirSync(MIG_DIR, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(MIG_DIR, name), sql);
  }
}

describe("migrate", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(MIG_DIR)) fs.rmSync(MIG_DIR, { recursive: true });
  });

  it("runs unrun migrations and bumps user_version", () => {
    setupMigrationsDir({
      "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);",
      "002-bar.sql": "CREATE TABLE bar (id TEXT PRIMARY KEY);",
    });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  it("is idempotent — second run is a no-op", () => {
    setupMigrationsDir({ "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);" });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("rolls back a failing migration without bumping user_version", () => {
    setupMigrationsDir({ "001-bad.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY); SELECT bogus_function();" });
    const db = resetDbForTesting(TEST_DB);
    expect(() => migrate(db, MIG_DIR)).toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'").all();
    expect(tables.length).toBe(0);
  });

  it("ignores files that don't match NNN-name.sql pattern", () => {
    setupMigrationsDir({
      "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);",
      "README.md": "noise",
      "no-number.sql": "CREATE TABLE noise (id TEXT PRIMARY KEY);",
    });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).not.toContain("noise");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/db.test.ts`

Expected: FAIL — `migrate is not exported from lib/db`.

- [ ] **Step 3: Implement `migrate` in `lib/db.ts`**

Append to `lib/db.ts`:

```typescript
import type Database from "better-sqlite3";

const MIGRATION_FILE_RE = /^(\d+)-[\w-]+\.sql$/;

export function migrate(db: Database.Database, dir?: string): void {
  const migrationsDir = dir ?? path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort();
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const f of files) {
    const match = f.match(MIGRATION_FILE_RE);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (n <= current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${n}`);
    })();
  }
}
```

Note: `path` and `fs` imports already exist at the top of `lib/db.ts`. `import type Database` for the type-only import.

- [ ] **Step 4: Add migrations dir + .gitkeep**

```bash
mkdir -p migrations
touch migrations/.gitkeep
```

- [ ] **Step 5: Run tests to verify passing**

Run: `npx vitest run tests/lib/db.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts tests/lib/db.test.ts migrations/.gitkeep
git commit -m "feat(db): migration runner with PRAGMA user_version tracking"
```

---

## Task 3: Wire `migrate(db)` into the connection lifecycle

**Files:**
- Modify: `lib/db.ts` (extend `getDb` to call `migrate` on first init)
- Modify: `scripts/init-db.ts` (call migrate after schema.sql so fresh DBs go to latest)

- [ ] **Step 1: Modify `getDb` in `lib/db.ts`**

Find the existing `getDb` function. Add a `migrate(dbInstance)` call at the end of the first-init branch (right before `return dbInstance`):

```typescript
export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;
  const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "dashboard.db");
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbInstance = new Database(resolvedPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  migrate(dbInstance);  // run pending migrations on first connection
  return dbInstance;
}
```

- [ ] **Step 2: Modify `scripts/init-db.ts` to also call migrate**

Replace the contents of `scripts/init-db.ts`:

```typescript
import { getDb, migrate } from "../lib/db";
import fs from "fs";
import path from "path";

function initDb(): void {
  const db = getDb();
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);  // apply any pending migrations after baseline schema
  console.log("Database initialized at data/dashboard.db");
}

initDb();
```

- [ ] **Step 3: Run full test suite to verify no regression**

Run: `npm test`

Expected: All existing tests still pass (currently 219 + 4 from Task 2 = 223). The migrate call inside getDb is safe — there are no migrations files yet (only `.gitkeep`), so it returns early via the `MIGRATION_FILE_RE` filter.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts scripts/init-db.ts
git commit -m "feat(db): run migrate(db) on first connection and after init schema"
```

---

## Task 4: Migration file `001-classifier.sql`

**Files:**
- Create: `migrations/001-classifier.sql`
- Create: `tests/migrations/001-classifier.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/migrations/001-classifier.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, migrate, getDb } from "../../lib/db";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-mig-001.db");

function loadBaselineSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
}

describe("migration 001-classifier", () => {
  beforeEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("creates new tables and adds columns to vault_notes", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("classification_proposals");
    expect(names).toContain("classification_log");
    expect(names).toContain("classifier_runs");

    const cols = db.prepare("PRAGMA table_info(vault_notes)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("classifier_skip");
    expect(colNames).toContain("classifier_attempts");
  });

  it("default values on new vault_notes columns are 0", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);

    db.prepare(
      "INSERT INTO vault_notes (id, vault_path, title, source, content_hash, modified_at, indexed_at, created_at) VALUES ('n1', 'a.md', 'A', 'obsidian', 'h', '2026-01-01', '2026-01-01', '2026-01-01')"
    ).run();
    const row = db.prepare("SELECT classifier_skip, classifier_attempts FROM vault_notes WHERE id = 'n1'").get() as {
      classifier_skip: number;
      classifier_attempts: number;
    };
    expect(row.classifier_skip).toBe(0);
    expect(row.classifier_attempts).toBe(0);
  });

  it("is idempotent — running twice is a no-op", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrations/001-classifier.test.ts`

Expected: FAIL — tables not created.

- [ ] **Step 3: Create the migration**

Create `migrations/001-classifier.sql`:

```sql
-- v1.3 — Whole-note auto-classify
-- Adds: classifier_skip + classifier_attempts on vault_notes;
--       classification_proposals, classification_log, classifier_runs tables.

ALTER TABLE vault_notes ADD COLUMN classifier_skip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vault_notes ADD COLUMN classifier_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS classifier_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  notes_seen INTEGER NOT NULL DEFAULT 0,
  notes_auto_assigned INTEGER NOT NULL DEFAULT 0,
  notes_auto_created INTEGER NOT NULL DEFAULT 0,
  notes_pending INTEGER NOT NULL DEFAULT 0,
  notes_errored INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS classification_proposals (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  proposed_existing_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
  existing_confidence REAL NOT NULL,
  proposed_new_bin_path TEXT,
  new_bin_rating REAL,
  no_fit_reasoning TEXT,
  reasoning TEXT NOT NULL,
  model TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES classifier_runs(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_note ON classification_proposals(note_id);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON classification_proposals(created_at);

CREATE TABLE IF NOT EXISTS classification_log (
  id TEXT PRIMARY KEY,
  note_id TEXT REFERENCES vault_notes(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  bin_id TEXT REFERENCES bins(id) ON DELETE SET NULL,
  new_bin_path TEXT,
  existing_confidence REAL,
  new_bin_rating REAL,
  reasoning TEXT,
  model TEXT,
  profile_id TEXT,
  run_id TEXT REFERENCES classifier_runs(id) ON DELETE SET NULL,
  prior_log_id TEXT REFERENCES classification_log(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_note ON classification_log(note_id);
CREATE INDEX IF NOT EXISTS idx_log_action_created ON classification_log(action, created_at);
```

- [ ] **Step 4: Run tests to verify passing**

Run: `npx vitest run tests/migrations/001-classifier.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -10`

Expected: all tests pass; total 226+.

- [ ] **Step 6: Commit**

```bash
git add migrations/001-classifier.sql tests/migrations/001-classifier.test.ts
git commit -m "feat(v1.3): migration 001-classifier — schema additions for auto-classify"
```

---

## Task 5: Classifier path utilities (`lib/classify/paths.ts`)

**Files:**
- Create: `lib/classify/paths.ts`
- Create: `tests/lib/classify/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/classify/paths.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { slugifyPath, buildBinTree, parentOf, tail, normalizeLlmPath } from "../../../lib/classify/paths";

interface BinRow {
  id: string;
  name: string;
  parent_bin_id: string | null;
}

const sample: BinRow[] = [
  { id: "b1", name: "Business Planning", parent_bin_id: null },
  { id: "b2", name: "OKRs", parent_bin_id: "b1" },
  { id: "b3", name: "Travel", parent_bin_id: null },
  { id: "b4", name: "Japan 2024", parent_bin_id: "b3" },
  { id: "b5", name: "!!!", parent_bin_id: null },
];

describe("slugifyPath", () => {
  it("walks parents and slugifies each segment", () => {
    expect(slugifyPath(sample[1], sample)).toBe("business-planning/okrs");
    expect(slugifyPath(sample[3], sample)).toBe("travel/japan-2024");
  });

  it("returns empty string for bins whose name slugifies to ''", () => {
    expect(slugifyPath(sample[4], sample)).toBe("");
  });

  it("returns just the slug for top-level bins", () => {
    expect(slugifyPath(sample[0], sample)).toBe("business-planning");
  });
});

describe("buildBinTree", () => {
  it("builds Map<slugPath, binId>", () => {
    const tree = buildBinTree(sample);
    expect(tree.get("business-planning")).toBe("b1");
    expect(tree.get("business-planning/okrs")).toBe("b2");
    expect(tree.get("travel/japan-2024")).toBe("b4");
  });

  it("skips empty-slug bins", () => {
    const tree = buildBinTree(sample);
    expect(tree.has("")).toBe(false);
  });
});

describe("parentOf", () => {
  it("returns parent path or null for top-level", () => {
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("a/b")).toBe("a");
    expect(parentOf("a")).toBe(null);
  });
});

describe("tail", () => {
  it("returns last segment", () => {
    expect(tail("a/b/c")).toBe("c");
    expect(tail("a")).toBe("a");
  });
});

describe("normalizeLlmPath", () => {
  it("lowercases, trims, collapses slashes, slugifies segments", () => {
    expect(normalizeLlmPath("Business Planning/OKRs")).toBe("business-planning/okrs");
    expect(normalizeLlmPath("/business-planning/okrs/")).toBe("business-planning/okrs");
    expect(normalizeLlmPath("Travel & Leisure/Japan 2024")).toBe("travel-leisure/japan-2024");
    expect(normalizeLlmPath("Deep  Work")).toBe("deep-work");
  });

  it("filters empty segments", () => {
    expect(normalizeLlmPath("a//b")).toBe("a/b");
    expect(normalizeLlmPath("///")).toBe("");
  });

  it("returns empty string when fully unrecognizable", () => {
    expect(normalizeLlmPath("!!!")).toBe("");
    expect(normalizeLlmPath("")).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/classify/paths.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/paths.ts`**

Create `lib/classify/paths.ts`:

```typescript
import { slugify } from "../utils";

export interface BinRow {
  id: string;
  name: string;
  parent_bin_id: string | null;
}

export function slugifyPath(bin: BinRow, allBins: BinRow[]): string {
  const segments: string[] = [];
  let cur: BinRow | undefined = bin;
  while (cur) {
    const seg = slugify(cur.name);
    if (!seg) return "";
    segments.unshift(seg);
    cur = cur.parent_bin_id
      ? allBins.find((b) => b.id === cur!.parent_bin_id)
      : undefined;
  }
  return segments.join("/");
}

export function buildBinTree(allBins: BinRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const bin of allBins) {
    const path = slugifyPath(bin, allBins);
    if (path) map.set(path, bin.id);
  }
  return map;
}

export function parentOf(slugPath: string): string | null {
  const idx = slugPath.lastIndexOf("/");
  if (idx === -1) return null;
  return slugPath.slice(0, idx);
}

export function tail(slugPath: string): string {
  const idx = slugPath.lastIndexOf("/");
  return idx === -1 ? slugPath : slugPath.slice(idx + 1);
}

export function normalizeLlmPath(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((s) => slugify(s))
    .filter((s) => s.length > 0)
    .join("/");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/classify/paths.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/paths.ts tests/lib/classify/paths.test.ts
git commit -m "feat(classify): paths.ts — slugifyPath, buildBinTree, normalizeLlmPath"
```

---

## Task 6: Classifier output parser (`lib/classify/parse.ts`)

**Files:**
- Create: `lib/classify/parse.ts`
- Create: `tests/lib/classify/parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/parse.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseClassifierOutput, ClassifierOutputError } from "../../../lib/classify/parse";

describe("parseClassifierOutput", () => {
  it("parses a valid existing-only response", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "travel/japan", confidence: 0.85, reasoning: "About Japan trip" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    const result = parseClassifierOutput(json);
    expect(result.existing_match.bin_path).toBe("travel/japan");
    expect(result.existing_match.confidence).toBe(0.85);
    expect(result.proposed_new_bin).toBeNull();
  });

  it("parses a valid new-bin response", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.31, reasoning: "Loosely about business" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.82, reasoning: "Q3 OKRs doc" },
      no_fit_reasoning: null,
    });
    const result = parseClassifierOutput(json);
    expect(result.proposed_new_bin?.path).toBe("business/planning/okrs");
    expect(result.proposed_new_bin?.rating).toBe(0.82);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseClassifierOutput("not json")).toThrow(ClassifierOutputError);
  });

  it("throws on missing required fields", () => {
    const json = JSON.stringify({ existing_match: { bin_path: "x" } });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on out-of-range confidence", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "x", confidence: 1.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on empty bin_path", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on empty proposed_new_bin.path", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "a", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: { path: "", rating: 0.8, reasoning: "r" },
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("strips fenced code blocks before parsing", () => {
    const fenced = "```json\n" + JSON.stringify({
      existing_match: { bin_path: "a", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }) + "\n```";
    const result = parseClassifierOutput(fenced);
    expect(result.existing_match.bin_path).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/parse.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/parse.ts`**

Create `lib/classify/parse.ts`:

```typescript
import { z } from "zod";

export class ClassifierOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "ClassifierOutputError";
  }
}

const ClassifierOutputSchema = z.object({
  existing_match: z.object({
    bin_path: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
  }),
  proposed_new_bin: z
    .object({
      path: z.string().min(1),
      rating: z.number().min(0).max(1),
      reasoning: z.string().min(1),
    })
    .nullable(),
  no_fit_reasoning: z.string().nullable(),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

export function parseClassifierOutput(raw: string): ClassifierOutput {
  const cleaned = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new ClassifierOutputError(`Not valid JSON: ${(e as Error).message}`, raw);
  }
  const result = ClassifierOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ClassifierOutputError(`Schema mismatch: ${result.error.message}`, raw);
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests to verify passing**

Run: `npx vitest run tests/lib/classify/parse.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/parse.ts tests/lib/classify/parse.test.ts
git commit -m "feat(classify): parse.ts — zod-validated LLM output parser with fence stripping"
```

---

## Task 7: Decide logic (`lib/classify/decide.ts`)

**Files:**
- Create: `lib/classify/decide.ts`
- Create: `tests/lib/classify/decide.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/decide.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decide, DEFAULT_THRESHOLDS } from "../../../lib/classify/decide";
import type { ClassifierOutput } from "../../../lib/classify/parse";

const tree = new Map<string, string>([
  ["travel", "b-travel"],
  ["travel/japan", "b-jp"],
  ["business", "b-biz"],
  ["business/planning", "b-plan"],
]);

function existing(path: string, confidence: number): ClassifierOutput["existing_match"] {
  return { bin_path: path, confidence, reasoning: "test" };
}

function newBin(path: string, rating: number): NonNullable<ClassifierOutput["proposed_new_bin"]> {
  return { path, rating, reasoning: "test" };
}

describe("decide", () => {
  const T = DEFAULT_THRESHOLDS;

  it("auto_assign when existing.confidence >= existing_min and path resolves", () => {
    const out: ClassifierOutput = { existing_match: existing("travel/japan", 0.8), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") expect(result.bin_id).toBe("b-jp");
  });

  it("converts proposed_new_bin to auto_assign when path already exists in tree", () => {
    const out: ClassifierOutput = {
      existing_match: existing("travel", 0.4),
      proposed_new_bin: newBin("travel/japan", 0.95),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") {
      expect(result.bin_id).toBe("b-jp");
      expect(result.converted_from_new_bin).toBe(true);
      expect(result.confidence_used).toBe(0.95);
    }
  });

  it("auto_assign sets converted_from_new_bin = false on existing-bin match", () => {
    const out: ClassifierOutput = {
      existing_match: existing("travel/japan", 0.8),
      proposed_new_bin: null,
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    if (result.action === "auto_assign") {
      expect(result.converted_from_new_bin).toBe(false);
      expect(result.confidence_used).toBe(0.8);
    }
  });

  it("auto_create_bin when rating >= floor, margin >= margin_threshold, parent exists", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs", 0.85),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_create_bin");
    if (result.action === "auto_create_bin") {
      expect(result.path).toBe("business/planning/okrs");
      expect(result.parent_bin_id).toBe("b-plan");
      expect(result.slug).toBe("okrs");
    }
  });

  it("pending when new-bin parent missing", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs/q3", 0.9),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("pending when new-bin rating below floor", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs", 0.7),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("pending when new-bin margin below threshold", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.7),
      proposed_new_bin: newBin("business/planning/okrs", 0.8),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    // margin = 0.1, < 0.3 threshold
    expect(result.action).toBe("pending");
  });

  it("pending when existing.confidence below threshold and no new-bin", () => {
    const out: ClassifierOutput = { existing_match: existing("travel/japan", 0.4), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("treats hallucinated path as confidence 0 → pending", () => {
    const out: ClassifierOutput = { existing_match: existing("nonexistent/path", 0.95), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("normalizes title-cased / spaced LLM paths before lookup", () => {
    const out: ClassifierOutput = { existing_match: existing("Travel/Japan", 0.8), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") expect(result.bin_id).toBe("b-jp");
  });

  it("auto_create wins when both gates pass (precedence)", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.6), // would auto_assign
      proposed_new_bin: newBin("business/planning/okrs", 0.95), // margin 0.35, rating > 0.75
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_create_bin");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/decide.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/decide.ts`**

Create `lib/classify/decide.ts`:

```typescript
import type { ClassifierOutput } from "./parse";
import { normalizeLlmPath, parentOf, tail } from "./paths";

export interface Thresholds {
  existing_min: number;
  new_bin_floor: number;
  new_bin_margin: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  existing_min: 0.6,
  new_bin_floor: 0.75,
  new_bin_margin: 0.3,
};

export type Decision =
  | { action: "auto_assign"; bin_id: string; confidence_used: number; converted_from_new_bin: boolean }
  | {
      action: "auto_create_bin";
      path: string;
      parent_bin_id: string;
      slug: string;
      name: string;
      rating: number;
    }
  | {
      action: "pending";
      existing_bin_id: string | null;
      existing_confidence: number;
      new_bin_path: string | null;
      new_bin_rating: number | null;
      no_fit_reasoning: string | null;
    };

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function decide(
  parsed: ClassifierOutput,
  thresholds: Thresholds,
  binTree: Map<string, string>,
): Decision {
  const existingPath = normalizeLlmPath(parsed.existing_match.bin_path);
  const existingConfidence = parsed.existing_match.confidence;
  const newPath = parsed.proposed_new_bin ? normalizeLlmPath(parsed.proposed_new_bin.path) : null;
  const newRating = parsed.proposed_new_bin?.rating ?? null;

  // (1) Proposed-path-already-exists short-circuit.
  if (newPath && binTree.has(newPath)) {
    return {
      action: "auto_assign",
      bin_id: binTree.get(newPath)!,
      confidence_used: newRating ?? 0,
      converted_from_new_bin: true,
    };
  }

  // (2) Auto-create new-bin gate.
  if (newPath && newRating !== null) {
    const margin = newRating - existingConfidence;
    const parentPath = parentOf(newPath);
    const parentExists = parentPath !== null && binTree.has(parentPath);
    if (
      newRating >= thresholds.new_bin_floor &&
      margin >= thresholds.new_bin_margin &&
      parentExists
    ) {
      const slug = tail(newPath);
      return {
        action: "auto_create_bin",
        path: newPath,
        parent_bin_id: binTree.get(parentPath!)!,
        slug,
        name: titleCase(slug),
        rating: newRating,
      };
    }
  }

  // (3) Auto-assign existing-bin gate.
  if (binTree.has(existingPath) && existingConfidence >= thresholds.existing_min) {
    return {
      action: "auto_assign",
      bin_id: binTree.get(existingPath)!,
      confidence_used: existingConfidence,
      converted_from_new_bin: false,
    };
  }

  // (4) Pending fallback.
  return {
    action: "pending",
    existing_bin_id: binTree.get(existingPath) ?? null,
    existing_confidence: existingConfidence,
    new_bin_path: newPath,
    new_bin_rating: newRating,
    no_fit_reasoning: parsed.no_fit_reasoning,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/classify/decide.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/decide.ts tests/lib/classify/decide.test.ts
git commit -m "feat(classify): decide.ts — threshold-gated routing with new-bin precedence"
```

---

## Task 8: Profile resolver (`lib/classify/profile.ts`)

**Files:**
- Create: `lib/classify/profile.ts`
- Create: `tests/lib/classify/profile.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/profile.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import { setSetting, setSettingJson } from "../../../lib/queries/app-settings";
import { resolveClassifyProfileId } from "../../../lib/classify/profile";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classify-profile.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
}

describe("resolveClassifyProfileId", () => {
  beforeEach(init);
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns classify.profile_id when set", () => {
    setSetting("classify.profile_id", "p-classify-1");
    setSetting("llm.active_profile_id", "p-chat-1");
    expect(resolveClassifyProfileId()).toBe("p-classify-1");
  });

  it("falls back to llm.active_profile_id when classify.profile_id unset", () => {
    setSetting("llm.active_profile_id", "p-chat-2");
    expect(resolveClassifyProfileId()).toBe("p-chat-2");
  });

  it("returns null when neither is set", () => {
    expect(resolveClassifyProfileId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/profile.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/profile.ts`**

Create `lib/classify/profile.ts`:

```typescript
import { getSetting } from "../queries/app-settings";

export function resolveClassifyProfileId(): string | null {
  const explicit = getSetting("classify.profile_id");
  if (explicit) return explicit;
  const active = getSetting("llm.active_profile_id");
  if (active) return active;
  return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/classify/profile.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/profile.ts tests/lib/classify/profile.test.ts
git commit -m "feat(classify): profile.ts — resolve classify profile with chat-profile fallback"
```

---

## Task 9: Prompt builder (`lib/classify/prompt.ts`)

**Files:**
- Create: `lib/classify/prompt.ts`
- Create: `tests/lib/classify/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildNoteUserMessage } from "../../../lib/classify/prompt";

describe("buildSystemPrompt", () => {
  it("includes the bin tree as slug paths", () => {
    const tree = new Map<string, string>([
      ["travel", "b-travel"],
      ["travel/japan", "b-jp"],
    ]);
    const out = buildSystemPrompt(tree);
    expect(out).toContain("travel\ntravel/japan");
  });

  it("instructs lowercase + hyphen path format", () => {
    const out = buildSystemPrompt(new Map());
    expect(out).toMatch(/lowercase paths with hyphens/i);
  });

  it("specifies the JSON output schema", () => {
    const out = buildSystemPrompt(new Map());
    expect(out).toContain("existing_match");
    expect(out).toContain("proposed_new_bin");
    expect(out).toContain("no_fit_reasoning");
  });

  it("sorts bin paths alphabetically for cache stability", () => {
    const tree = new Map<string, string>([
      ["zebra", "b-z"],
      ["apple", "b-a"],
      ["mango", "b-m"],
    ]);
    const out = buildSystemPrompt(tree);
    const aIdx = out.indexOf("apple");
    const mIdx = out.indexOf("mango");
    const zIdx = out.indexOf("zebra");
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });
});

describe("buildNoteUserMessage", () => {
  it("includes title and body", () => {
    const out = buildNoteUserMessage({ title: "Tokyo trip", frontmatter: {}, body: "Itinerary draft" });
    expect(out).toContain("Tokyo trip");
    expect(out).toContain("Itinerary draft");
  });

  it("strips bins from frontmatter (already used for override)", () => {
    const out = buildNoteUserMessage({
      title: "X",
      frontmatter: { tags: ["travel"], bins: ["travel/japan"] },
      body: "B",
    });
    expect(out).toContain("tags");
    expect(out).not.toContain('"travel/japan"');
  });

  it("truncates body over ~6000 tokens (~24000 chars)", () => {
    const longBody = "x".repeat(40000);
    const out = buildNoteUserMessage({ title: "T", frontmatter: {}, body: longBody });
    expect(out.length).toBeLessThan(30000);
    expect(out).toContain("[truncated]");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/prompt.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/prompt.ts`**

Create `lib/classify/prompt.ts`:

```typescript
const MAX_BODY_CHARS = 24000;

export function buildSystemPrompt(binTree: Map<string, string>): string {
  const paths = Array.from(binTree.keys()).sort();
  const treeBlock = paths.length > 0 ? paths.join("\n") : "(empty bin tree)";
  return `You are a knowledge organizer for a personal vault. Classify the given note into the single best-fitting bin from the tree below.

Rules:
1. Return your top-1 best-matching existing bin with a confidence score in [0, 1].
2. If you believe NO existing bin is a good fit, ALSO propose a new bin path under an existing parent. Provide a rating in [0, 1].
3. If neither would be appropriate, fill \`no_fit_reasoning\` and leave both null/low.
4. ALWAYS use lowercase paths with hyphens, exactly matching the slugs shown below (e.g. \`business-planning/okrs\`, never \`Business Planning/OKRs\`).

Confidence/rating calibration:
  0.9+    = certain
  0.7-0.9 = confident
  0.5-0.7 = likely
  <0.5    = uncertain — say so honestly

Strong preference for existing bins. Only propose new bins when the existing tree genuinely cannot accommodate the content.

Bin tree (canonical slug paths):
${treeBlock}

Return JSON matching this schema:
{
  "existing_match": { "bin_path": string, "confidence": number, "reasoning": string },
  "proposed_new_bin": { "path": string, "rating": number, "reasoning": string } | null,
  "no_fit_reasoning": string | null
}`;
}

interface NoteForPrompt {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function buildNoteUserMessage(note: NoteForPrompt): string {
  const fm = { ...note.frontmatter };
  delete (fm as { bins?: unknown }).bins;
  const fmBlock = Object.keys(fm).length > 0 ? `Frontmatter: ${JSON.stringify(fm)}\n\n` : "";
  let body = note.body;
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS) + "\n\n[truncated]";
  }
  return `Title: ${note.title}\n\n${fmBlock}${body}`;
}
```

- [ ] **Step 4: Run tests to verify passing**

Run: `npx vitest run tests/lib/classify/prompt.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/prompt.ts tests/lib/classify/prompt.test.ts
git commit -m "feat(classify): prompt.ts — system prompt + per-note user message builder"
```

---

## Task 10: Rate limiter (`lib/classify/rate-limit.ts`)

**Files:**
- Create: `lib/classify/rate-limit.ts`
- Create: `tests/lib/classify/rate-limit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/rate-limit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../../lib/classify/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit immediately", async () => {
    const acquire = createRateLimiter({ rpm: 60, windowMs: 1000 });
    const start = Date.now();
    await Promise.all([acquire(), acquire(), acquire()]);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("delays the request that exceeds the bucket", async () => {
    // 2 RPM over a 300ms window → 1 token refills every 150ms.
    // After draining the initial 2 tokens, the 3rd must wait ≥80ms (jitter-tolerant)
    // before a refill makes one available.
    const acquire = createRateLimiter({ rpm: 2, windowMs: 300 });
    await acquire();
    await acquire();
    const start = Date.now();
    await acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("refills tokens over time", async () => {
    const acquire = createRateLimiter({ rpm: 4, windowMs: 200 });
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    await new Promise((r) => setTimeout(r, 220));
    const start = Date.now();
    await acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/rate-limit.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/rate-limit.ts`**

Create `lib/classify/rate-limit.ts`:

```typescript
export interface RateLimiterConfig {
  rpm: number;
  windowMs?: number;
}

export function createRateLimiter(config: RateLimiterConfig): () => Promise<void> {
  const windowMs = config.windowMs ?? 60_000;
  const capacity = config.rpm;
  let tokens = capacity;
  let lastRefillAt = Date.now();
  const queue: (() => void)[] = [];

  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefillAt;
    if (elapsed >= windowMs) {
      tokens = capacity;
      lastRefillAt = now;
      return;
    }
    const refillAmount = Math.floor((elapsed / windowMs) * capacity);
    if (refillAmount > 0) {
      tokens = Math.min(capacity, tokens + refillAmount);
      lastRefillAt = now;
    }
  }

  function tryDrain(): void {
    refill();
    while (tokens > 0 && queue.length > 0) {
      tokens -= 1;
      const next = queue.shift()!;
      next();
    }
    if (queue.length > 0) {
      const msPerToken = windowMs / capacity;
      setTimeout(tryDrain, Math.max(10, msPerToken));
    }
  }

  return function acquire(): Promise<void> {
    return new Promise((resolve) => {
      queue.push(resolve);
      tryDrain();
    });
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/classify/rate-limit.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/rate-limit.ts tests/lib/classify/rate-limit.test.ts
git commit -m "feat(classify): rate-limit.ts — token bucket for RPM throttling"
```

---

## Task 11: Classification queries (`lib/queries/classifications.ts`)

**Files:**
- Create: `lib/queries/classifications.ts`
- Create: `tests/lib/queries/classifications.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/queries/classifications.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import {
  insertClassifierRun,
  finishClassifierRun,
  countInFlightRuns,
  insertProposal,
  insertLogRow,
  listPendingProposals,
  listRecentlyAutoClassified,
  acceptProposal,
  rejectProposal,
  undoAutoClassification,
  setClassifierSkip,
  acquireRunLock,
  ConcurrentRunError,
} from "../../../lib/queries/classifications";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import { newId, nowIso } from "../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classifications.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
}

function seedNote(slug = "note-a"): string {
  const note = upsertVaultNote({
    vault_path: `${slug}.md`,
    title: slug,
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "h",
    modified_at: nowIso(),
  });
  return note.id;
}

describe("classifier_runs", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("inserts a run row", () => {
    const id = insertClassifierRun({ trigger: "manual" });
    expect(id).toBeTruthy();
    const inFlight = countInFlightRuns();
    expect(inFlight).toBe(1);
  });

  it("acquireRunLock succeeds when no in-flight run", () => {
    const id = acquireRunLock("manual");
    expect(id).toBeTruthy();
  });

  it("acquireRunLock throws ConcurrentRunError when one in flight", () => {
    acquireRunLock("manual");
    expect(() => acquireRunLock("cron")).toThrow(ConcurrentRunError);
  });

  it("acquireRunLock sweeps orphan rows older than 30 minutes", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)"
    ).run("orphan-1", "cron", Date.now() - 31 * 60_000);
    expect(() => acquireRunLock("manual")).not.toThrow();
    const orphan = db.prepare("SELECT finished_at, error_message FROM classifier_runs WHERE id = 'orphan-1'").get() as {
      finished_at: number;
      error_message: string;
    };
    expect(orphan.finished_at).toBeTruthy();
    expect(orphan.error_message).toBe("orphan_recovered");
  });

  it("finishClassifierRun updates row", () => {
    const id = insertClassifierRun({ trigger: "manual" });
    finishClassifierRun(id, { notes_seen: 5, notes_auto_assigned: 3, notes_auto_created: 1, notes_pending: 1, notes_errored: 0 });
    expect(countInFlightRuns()).toBe(0);
  });
});

describe("proposals + log", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("insertProposal then listPendingProposals returns it", () => {
    const noteId = seedNote("note-a");
    const bin = createBin({ name: "Travel" });
    const runId = insertClassifierRun({ trigger: "manual" });
    insertProposal({
      note_id: noteId,
      proposed_existing_bin_id: bin.id,
      existing_confidence: 0.5,
      proposed_new_bin_path: null,
      new_bin_rating: null,
      no_fit_reasoning: null,
      reasoning: "test",
      model: "haiku",
      profile_id: "p-1",
      run_id: runId,
    });
    const pending = listPendingProposals();
    expect(pending.length).toBe(1);
    expect(pending[0].note_id).toBe(noteId);
  });

  it("listRecentlyAutoClassified excludes notes with newer 'undone' rows", () => {
    const noteId = seedNote("note-a");
    const bin = createBin({ name: "Travel" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const t = Date.now();
    insertLogRow({
      action: "auto_assign",
      note_id: noteId,
      bin_id: bin.id,
      new_bin_path: null,
      existing_confidence: 0.9,
      new_bin_rating: null,
      reasoning: "r",
      model: "haiku",
      profile_id: "p-1",
      run_id: runId,
      prior_log_id: null,
      created_at: t,
    });
    expect(listRecentlyAutoClassified().length).toBe(1);
    insertLogRow({
      action: "undone",
      note_id: noteId,
      bin_id: bin.id,
      new_bin_path: null,
      existing_confidence: null,
      new_bin_rating: null,
      reasoning: null,
      model: null,
      profile_id: null,
      run_id: runId,
      prior_log_id: null,
      created_at: t + 1000,
    });
    expect(listRecentlyAutoClassified().length).toBe(0);
  });
});

describe("setClassifierSkip", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("toggles classifier_skip flag", () => {
    const noteId = seedNote("note-a");
    setClassifierSkip(noteId, true);
    const db = getDb();
    const row = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
    setClassifierSkip(noteId, false);
    const row2 = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row2.classifier_skip).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/queries/classifications.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/queries/classifications.ts`**

Create `lib/queries/classifications.ts`:

```typescript
import { getDb } from "../db";
import { newId, slugify } from "../utils";

const ORPHAN_THRESHOLD_MS = 30 * 60_000;

export class ConcurrentRunError extends Error {
  constructor() {
    super("classifier run already in flight");
    this.name = "ConcurrentRunError";
  }
}

export function insertClassifierRun(params: { trigger: "cron" | "manual"; id?: string }): string {
  const id = params.id ?? newId();
  const db = getDb();
  db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)").run(id, params.trigger, Date.now());
  return id;
}

export function countInFlightRuns(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as n FROM classifier_runs WHERE finished_at IS NULL").get() as { n: number };
  return row.n;
}

export function acquireRunLock(trigger: "cron" | "manual"): string {
  const db = getDb();
  const id = newId();
  const now = Date.now();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "UPDATE classifier_runs SET finished_at = ?, error_message = 'orphan_recovered' WHERE finished_at IS NULL AND started_at < ?"
    ).run(now, now - ORPHAN_THRESHOLD_MS);
    const inFlight = db.prepare("SELECT COUNT(*) as n FROM classifier_runs WHERE finished_at IS NULL").get() as { n: number };
    if (inFlight.n > 0) {
      db.exec("ROLLBACK");
      throw new ConcurrentRunError();
    }
    db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)").run(id, trigger, now);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    if (e instanceof ConcurrentRunError) throw e;
    if (e instanceof Error && /SQLITE_BUSY/i.test(e.message)) {
      throw new ConcurrentRunError();
    }
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

export interface ClassifierRunSummary {
  notes_seen: number;
  notes_auto_assigned: number;
  notes_auto_created: number;
  notes_pending: number;
  notes_errored: number;
  error_message?: string | null;
}

export function finishClassifierRun(id: string, summary: ClassifierRunSummary): void {
  const db = getDb();
  db.prepare(
    `UPDATE classifier_runs SET finished_at = ?, notes_seen = ?, notes_auto_assigned = ?,
     notes_auto_created = ?, notes_pending = ?, notes_errored = ?, error_message = ? WHERE id = ?`
  ).run(
    Date.now(),
    summary.notes_seen,
    summary.notes_auto_assigned,
    summary.notes_auto_created,
    summary.notes_pending,
    summary.notes_errored,
    summary.error_message ?? null,
    id,
  );
}

export interface ProposalInsert {
  id?: string;
  note_id: string;
  proposed_existing_bin_id: string | null;
  existing_confidence: number;
  proposed_new_bin_path: string | null;
  new_bin_rating: number | null;
  no_fit_reasoning: string | null;
  reasoning: string;
  model: string;
  profile_id: string;
  run_id: string;
}

export function insertProposal(p: ProposalInsert): string {
  const id = p.id ?? newId();
  const db = getDb();
  db.prepare(
    `INSERT INTO classification_proposals
     (id, note_id, proposed_existing_bin_id, existing_confidence, proposed_new_bin_path,
      new_bin_rating, no_fit_reasoning, reasoning, model, profile_id, run_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, p.note_id, p.proposed_existing_bin_id, p.existing_confidence, p.proposed_new_bin_path,
    p.new_bin_rating, p.no_fit_reasoning, p.reasoning, p.model, p.profile_id, p.run_id, Date.now(),
  );
  return id;
}

export interface LogRowInsert {
  id?: string;
  note_id: string | null;
  action: "auto_assign" | "auto_create_bin" | "pending" | "accepted" | "rejected" | "undone" | "error";
  bin_id: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  model: string | null;
  profile_id: string | null;
  run_id: string | null;
  prior_log_id: string | null;
  created_at?: number;
}

export function insertLogRow(p: LogRowInsert): string {
  const id = p.id ?? newId();
  const db = getDb();
  db.prepare(
    `INSERT INTO classification_log
     (id, note_id, action, bin_id, new_bin_path, existing_confidence, new_bin_rating,
      reasoning, model, profile_id, run_id, prior_log_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, p.note_id, p.action, p.bin_id, p.new_bin_path, p.existing_confidence, p.new_bin_rating,
    p.reasoning, p.model, p.profile_id, p.run_id, p.prior_log_id, p.created_at ?? Date.now(),
  );
  return id;
}

export interface ProposalRow {
  id: string;
  note_id: string;
  note_title: string;
  proposed_existing_bin_id: string | null;
  existing_confidence: number;
  proposed_new_bin_path: string | null;
  new_bin_rating: number | null;
  no_fit_reasoning: string | null;
  reasoning: string;
  model: string;
  created_at: number;
}

export function listPendingProposals(): ProposalRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT cp.id, cp.note_id, vn.title as note_title, cp.proposed_existing_bin_id,
     cp.existing_confidence, cp.proposed_new_bin_path, cp.new_bin_rating, cp.no_fit_reasoning,
     cp.reasoning, cp.model, cp.created_at
     FROM classification_proposals cp
     JOIN vault_notes vn ON vn.id = cp.note_id
     ORDER BY cp.created_at DESC`
  ).all() as ProposalRow[];
}

export interface RecentAutoRow {
  id: string;
  note_id: string;
  note_title: string;
  action: "auto_assign" | "auto_create_bin";
  bin_id: string | null;
  bin_name: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  created_at: number;
}

export function listRecentlyAutoClassified(): RecentAutoRow[] {
  const db = getDb();
  const cutoff = Date.now() - 7 * 86400_000;
  return db.prepare(
    `SELECT a.id, a.note_id, vn.title as note_title, a.action, a.bin_id,
     b.name as bin_name, a.new_bin_path, a.existing_confidence, a.new_bin_rating,
     a.reasoning, a.created_at
     FROM classification_log a
     JOIN vault_notes vn ON vn.id = a.note_id
     LEFT JOIN bins b ON b.id = a.bin_id
     WHERE a.action IN ('auto_assign', 'auto_create_bin')
       AND a.created_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM classification_log u
         WHERE u.note_id = a.note_id AND u.action = 'undone' AND u.created_at > a.created_at
       )
     ORDER BY a.created_at DESC`
  ).all(cutoff) as RecentAutoRow[];
}

export interface AcceptProposalArgs {
  proposalId: string;
  binId: string;       // resolved bin id (existing or freshly created)
  isNewBin: boolean;   // true if a new bin was just created during accept
}

export function acceptProposal(args: AcceptProposalArgs): void {
  const db = getDb();
  const proposal = db.prepare("SELECT * FROM classification_proposals WHERE id = ?").get(args.proposalId) as {
    id: string; note_id: string; reasoning: string; model: string; profile_id: string; run_id: string;
    existing_confidence: number; new_bin_rating: number | null; proposed_new_bin_path: string | null;
  } | undefined;
  if (!proposal) throw new Error(`proposal ${args.proposalId} not found`);
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')`
    ).run(proposal.note_id, args.binId, new Date().toISOString());
    db.prepare("DELETE FROM classification_proposals WHERE id = ?").run(args.proposalId);
    insertLogRow({
      note_id: proposal.note_id,
      action: "accepted",
      bin_id: args.binId,
      new_bin_path: args.isNewBin ? proposal.proposed_new_bin_path : null,
      existing_confidence: proposal.existing_confidence,
      new_bin_rating: proposal.new_bin_rating,
      reasoning: proposal.reasoning,
      model: proposal.model,
      profile_id: proposal.profile_id,
      run_id: proposal.run_id,
      prior_log_id: null,
    });
  })();
}

export function rejectProposal(proposalId: string): void {
  const db = getDb();
  const proposal = db.prepare("SELECT * FROM classification_proposals WHERE id = ?").get(proposalId) as {
    id: string; note_id: string; reasoning: string; model: string; profile_id: string; run_id: string;
    existing_confidence: number; new_bin_rating: number | null;
  } | undefined;
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  db.transaction(() => {
    db.prepare("UPDATE vault_notes SET classifier_attempts = classifier_attempts + 1 WHERE id = ?").run(proposal.note_id);
    const attempts = (db.prepare("SELECT classifier_attempts FROM vault_notes WHERE id = ?").get(proposal.note_id) as { classifier_attempts: number }).classifier_attempts;
    if (attempts >= 3) {
      db.prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(proposal.note_id);
    }
    db.prepare("DELETE FROM classification_proposals WHERE id = ?").run(proposalId);
    insertLogRow({
      note_id: proposal.note_id,
      action: "rejected",
      bin_id: null,
      new_bin_path: null,
      existing_confidence: proposal.existing_confidence,
      new_bin_rating: proposal.new_bin_rating,
      reasoning: null,
      model: proposal.model,
      profile_id: proposal.profile_id,
      run_id: proposal.run_id,
      prior_log_id: null,
    });
  })();
}

export function undoAutoClassification(logId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM classification_log WHERE id = ?").get(logId) as {
    id: string; note_id: string; action: string; bin_id: string | null;
  } | undefined;
  if (!row) throw new Error(`log row ${logId} not found`);
  if (!row.note_id || !row.bin_id) throw new Error("log row missing note_id/bin_id; cannot undo");
  db.transaction(() => {
    db.prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(row.note_id, row.bin_id);
    if (row.action === "auto_create_bin") {
      const remaining = (db.prepare("SELECT COUNT(*) as n FROM note_bins WHERE bin_id = ?").get(row.bin_id) as { n: number }).n;
      if (remaining === 0) {
        db.prepare("DELETE FROM bins WHERE id = ?").run(row.bin_id);
      }
    }
    db.prepare("UPDATE vault_notes SET classifier_attempts = classifier_attempts + 1 WHERE id = ?").run(row.note_id);
    insertLogRow({
      note_id: row.note_id,
      action: "undone",
      bin_id: row.bin_id,
      new_bin_path: null,
      existing_confidence: null,
      new_bin_rating: null,
      reasoning: null,
      model: null,
      profile_id: null,
      run_id: null,
      prior_log_id: row.id,
    });
  })();
}

export function setClassifierSkip(noteId: string, skip: boolean): void {
  const db = getDb();
  db.prepare("UPDATE vault_notes SET classifier_skip = ? WHERE id = ?").run(skip ? 1 : 0, noteId);
}

export function findExistingBinByParentAndSlug(parentBinId: string | null, slug: string): { id: string; name: string } | null {
  const db = getDb();
  const candidates = db.prepare("SELECT id, name FROM bins WHERE parent_bin_id IS ?").all(parentBinId) as { id: string; name: string }[];
  for (const c of candidates) {
    if (slugify(c.name) === slug) return c;
  }
  return null;
}

export function listUnclassifiedNotes(limit: number): { id: string; title: string; vault_path: string }[] {
  const db = getDb();
  return db.prepare(
    `SELECT vn.id, vn.title, vn.vault_path
     FROM vault_notes vn
     WHERE vn.classifier_skip = 0
       AND vn.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM note_bins nb WHERE nb.note_id = vn.id)
       AND NOT EXISTS (SELECT 1 FROM classification_proposals cp WHERE cp.note_id = vn.id)
     ORDER BY vn.modified_at DESC
     LIMIT ?`
  ).all(limit) as { id: string; title: string; vault_path: string }[];
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/queries/classifications.test.ts`

Expected: tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -10`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/classifications.ts tests/lib/queries/classifications.test.ts
git commit -m "feat(classify): queries — runs, proposals, log, accept/reject/undo, skip flag"
```

---

## Task 12: Per-note runner (`lib/classify/run.ts`)

**Files:**
- Create: `lib/classify/run.ts`
- Create: `tests/lib/classify/run.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/run.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import { createBin } from "../../../lib/queries/bins";
import { newId, nowIso } from "../../../lib/utils";
import { runClassifyOnce } from "../../../lib/classify/run";
import type { ClassifierLlm } from "../../../lib/classify/run";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classify-run.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

function seedNote(slug: string, title: string): string {
  const note = upsertVaultNote({
    vault_path: `${slug}.md`, title, source: "obsidian",
    source_id: null, source_url: null,
    content_hash: "h", modified_at: nowIso(),
  });
  return note.id;
}

function fakeLlm(response: string): ClassifierLlm {
  return { complete: vi.fn(async () => response), modelName: "fake-haiku" };
}

describe("runClassifyOnce", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("auto-assigns a note when LLM is confident on existing bin", async () => {
    const bin = createBin({ name: "Travel" });
    const noteId = seedNote("note-a", "Tokyo trip");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "travel", confidence: 0.9, reasoning: "Travel-related" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Tokyo trip", frontmatter: {}, body: "Trip notes" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_assign");
    const db = getDb();
    const assignment = db.prepare("SELECT * FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, bin.id);
    expect(assignment).toBeTruthy();
    const log = db.prepare("SELECT * FROM classification_log WHERE note_id = ?").all(noteId);
    expect(log.length).toBe(1);
    expect((log[0] as { action: string }).action).toBe("auto_assign");
  });

  it("auto-creates a bin when gates pass", async () => {
    const parent = createBin({ name: "Business" });
    createBin({ name: "Planning", parent_bin_id: parent.id });
    const noteId = seedNote("note-okrs", "Q3 OKRs");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.3, reasoning: "loose" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.85, reasoning: "OKRs doc" },
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Q3 OKRs", frontmatter: {}, body: "OKRs" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_create_bin");
    const db = getDb();
    const newBin = db.prepare("SELECT id, name FROM bins WHERE name = 'Okrs'").get() as { id: string; name: string } | undefined;
    expect(newBin).toBeTruthy();
  });

  it("converts to auto_assign at commit if another note already created the bin", async () => {
    const parent = createBin({ name: "Business" });
    createBin({ name: "Planning", parent_bin_id: parent.id });
    const noteId = seedNote("note-okrs2", "Q3 OKRs");
    // pre-create the bin to simulate concurrent commit
    const planning = (getDb().prepare("SELECT id FROM bins WHERE name = 'Planning'").get() as { id: string }).id;
    createBin({ name: "Okrs", parent_bin_id: planning });
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.3, reasoning: "loose" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.85, reasoning: "OKRs doc" },
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Q3 OKRs", frontmatter: {}, body: "OKRs" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_assign");
    const db = getDb();
    const okrsBins = db.prepare("SELECT COUNT(*) as n FROM bins WHERE name = 'Okrs'").get() as { n: number };
    expect(okrsBins.n).toBe(1);
  });

  it("queues pending when gates fail", async () => {
    createBin({ name: "Travel" });
    const noteId = seedNote("note-vague", "Vague note");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "travel", confidence: 0.4, reasoning: "weak" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Vague", frontmatter: {}, body: "x" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("pending");
    const db = getDb();
    const pending = db.prepare("SELECT * FROM classification_proposals WHERE note_id = ?").get(noteId);
    expect(pending).toBeTruthy();
  });

  it("retries once on malformed JSON, then logs error", async () => {
    createBin({ name: "Travel" });
    const noteId = seedNote("note-bad", "X");
    const llm: ClassifierLlm = { complete: vi.fn().mockResolvedValueOnce("not json").mockResolvedValueOnce("still not json"), modelName: "fake" };
    const result = await runClassifyOnce({ note: { id: noteId, title: "X", frontmatter: {}, body: "x" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("error");
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const db = getDb();
    const errLog = db.prepare("SELECT * FROM classification_log WHERE note_id = ? AND action = 'error'").get(noteId);
    expect(errLog).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/run.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/run.ts`**

Create `lib/classify/run.ts`:

```typescript
import { getDb } from "../db";
import { listBins } from "../queries/bins";
import {
  insertProposal, insertLogRow, findExistingBinByParentAndSlug,
} from "../queries/classifications";
import { newId } from "../utils";
import { buildBinTree, type BinRow } from "./paths";
import { decide, DEFAULT_THRESHOLDS, type Thresholds } from "./decide";
import { parseClassifierOutput, ClassifierOutputError } from "./parse";
import { buildSystemPrompt, buildNoteUserMessage } from "./prompt";

export interface ClassifierLlm {
  complete: (system: string, user: string) => Promise<string>;
  modelName: string;
}

export interface NoteForRun {
  id: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface RunArgs {
  note: NoteForRun;
  llm: ClassifierLlm;
  runId: string;
  profileId: string;
  thresholds?: Thresholds;
}

export type RunResult =
  | { action: "auto_assign" | "auto_create_bin" | "pending" }
  | { action: "error"; reason: string };

const RETRY_FOLLOWUP = "Your previous response was not valid JSON. Return ONLY valid JSON matching the schema, no prose, no markdown.";

export async function runClassifyOnce(args: RunArgs): Promise<RunResult> {
  const db = getDb();
  const thresholds = args.thresholds ?? DEFAULT_THRESHOLDS;
  const bins = listBins() as BinRow[];
  const tree = buildBinTree(bins);
  const system = buildSystemPrompt(tree);
  const user = buildNoteUserMessage(args.note);

  let raw: string;
  try {
    raw = await args.llm.complete(system, user);
  } catch (e) {
    return logErrorAndReturn(db, args, `llm_call_failed: ${(e as Error).message}`);
  }

  let parsed;
  try {
    parsed = parseClassifierOutput(raw);
  } catch (e) {
    if (!(e instanceof ClassifierOutputError)) {
      return logErrorAndReturn(db, args, `parse_failed: ${(e as Error).message}`);
    }
    let raw2: string;
    try {
      raw2 = await args.llm.complete(system + "\n\n" + RETRY_FOLLOWUP, user);
    } catch (e2) {
      return logErrorAndReturn(db, args, `llm_retry_failed: ${(e2 as Error).message}`);
    }
    try {
      parsed = parseClassifierOutput(raw2);
    } catch (e3) {
      return logErrorAndReturn(db, args, `parse_failed_after_retry: ${(e3 as Error).message}`);
    }
  }

  const decision = decide(parsed, thresholds, tree);

  if (decision.action === "auto_assign") {
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')")
        .run(args.note.id, decision.bin_id, new Date().toISOString());
      insertLogRow({
        note_id: args.note.id,
        action: "auto_assign",
        bin_id: decision.bin_id,
        new_bin_path: null,
        existing_confidence: decision.confidence_used,
        new_bin_rating: null,
        reasoning: parsed.existing_match.reasoning,
        model: args.llm.modelName,
        profile_id: args.profileId,
        run_id: args.runId,
        prior_log_id: null,
      });
    })();
    return { action: "auto_assign" };
  }

  if (decision.action === "auto_create_bin") {
    let resolvedBinId: string;
    let resolvedAction: "auto_assign" | "auto_create_bin" = "auto_create_bin";
    db.transaction(() => {
      const existing = findExistingBinByParentAndSlug(decision.parent_bin_id, decision.slug);
      if (existing) {
        resolvedBinId = existing.id;
        resolvedAction = "auto_assign";
      } else {
        const newBinId = newId();
        db.prepare(
          "INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order) VALUES (?, ?, ?, NULL, ?, ?)"
        ).run(newBinId, decision.name, decision.parent_bin_id, new Date().toISOString(), 0);
        resolvedBinId = newBinId;
      }
      db.prepare("INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')")
        .run(args.note.id, resolvedBinId, new Date().toISOString());
      insertLogRow({
        note_id: args.note.id,
        action: resolvedAction,
        bin_id: resolvedBinId,
        new_bin_path: resolvedAction === "auto_create_bin" ? decision.path : null,
        existing_confidence: null,
        new_bin_rating: decision.rating,
        reasoning: parsed.proposed_new_bin?.reasoning ?? null,
        model: args.llm.modelName,
        profile_id: args.profileId,
        run_id: args.runId,
        prior_log_id: null,
      });
    })();
    return { action: resolvedAction };
  }

  // pending
  insertProposal({
    note_id: args.note.id,
    proposed_existing_bin_id: decision.existing_bin_id,
    existing_confidence: decision.existing_confidence,
    proposed_new_bin_path: decision.new_bin_path,
    new_bin_rating: decision.new_bin_rating,
    no_fit_reasoning: decision.no_fit_reasoning,
    reasoning: parsed.existing_match.reasoning + (parsed.proposed_new_bin ? ` || new-bin: ${parsed.proposed_new_bin.reasoning}` : ""),
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
  });
  insertLogRow({
    note_id: args.note.id,
    action: "pending",
    bin_id: decision.existing_bin_id,
    new_bin_path: decision.new_bin_path,
    existing_confidence: decision.existing_confidence,
    new_bin_rating: decision.new_bin_rating,
    reasoning: parsed.existing_match.reasoning,
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
    prior_log_id: null,
  });
  return { action: "pending" };
}

function logErrorAndReturn(_db: unknown, args: RunArgs, reason: string): RunResult {
  insertLogRow({
    note_id: args.note.id,
    action: "error",
    bin_id: null,
    new_bin_path: null,
    existing_confidence: null,
    new_bin_rating: null,
    reasoning: reason,
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
    prior_log_id: null,
  });
  return { action: "error", reason };
}
```

- [ ] **Step 4: Run tests to verify passing**

Run: `npx vitest run tests/lib/classify/run.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/run.ts tests/lib/classify/run.test.ts
git commit -m "feat(classify): run.ts — per-note pipeline with retry, race-safe commit"
```

---

## Task 13: LLM adapter for classifier (`lib/classify/llm-adapter.ts`)

**Files:**
- Create: `lib/classify/llm-adapter.ts`
- Create: `tests/lib/classify/llm-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/classify/llm-adapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { type LlmProfile } from "../../../lib/llm/types";
import { buildClassifierLlm } from "../../../lib/classify/llm-adapter";

describe("buildClassifierLlm", () => {
  it("returns a ClassifierLlm with modelName from profile.default_model", () => {
    const profile: LlmProfile = {
      id: "p1",
      name: "test",
      type: "anthropic",
      api_key_encrypted: "x",
      default_model: "claude-haiku-4-5",
      max_context_tokens: 200000,
      created_at: "2026-01-01",
    };
    const adapter = buildClassifierLlm(profile);
    expect(adapter.modelName).toBe("claude-haiku-4-5");
    expect(typeof adapter.complete).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/lib/classify/llm-adapter.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify/llm-adapter.ts`**

Create `lib/classify/llm-adapter.ts`:

```typescript
import type { LlmProfile } from "../llm/types";
import { getProfileSecret } from "../llm/profiles";
import type { ClassifierLlm } from "./run";

export function buildClassifierLlm(profile: LlmProfile): ClassifierLlm {
  const modelName = profile.default_model;
  return {
    modelName,
    async complete(system: string, user: string): Promise<string> {
      const apiKey = getProfileSecret(profile.id);
      if (profile.type === "anthropic") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });
        const result = await client.messages.create({
          model: profile.default_model,
          max_tokens: 1024,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
        });
        const block = result.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new Error("no text block in Anthropic response");
        return block.text;
      } else {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey, baseURL: profile.base_url });
        const result = await client.chat.completions.create({
          model: profile.default_model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1024,
        });
        const text = result.choices[0]?.message?.content;
        if (!text) throw new Error("no content in OpenAI-compat response");
        return text;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/classify/llm-adapter.test.ts`

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/classify/llm-adapter.ts tests/lib/classify/llm-adapter.test.ts
git commit -m "feat(classify): llm-adapter.ts — bridge from LlmProfile to ClassifierLlm"
```

---

## Task 14: Classifier entry script (`scripts/agent-classify.ts`)

**Files:**
- Create: `scripts/agent-classify.ts`
- Modify: `package.json` (add `classify` script)
- Create: `tests/scripts/agent-classify.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/scripts/agent-classify.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../lib/db";
import { upsertVaultNote } from "../../lib/queries/vault-notes";
import { createBin } from "../../lib/queries/bins";
import { newId, nowIso } from "../../lib/utils";
import { runClassifierBatch } from "../../scripts/agent-classify";
import type { ClassifierLlm } from "../../lib/classify/run";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classifier-batch.db");
const TEST_VAULT = path.join(process.cwd(), "data", "test-vault-batch");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true });
  fs.mkdirSync(TEST_VAULT, { recursive: true });
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

function seed(name: string, body = "body"): string {
  const vaultPath = `${name}.md`;
  fs.writeFileSync(path.join(TEST_VAULT, vaultPath), body);
  const note = upsertVaultNote({
    vault_path: vaultPath, title: name, source: "obsidian",
    source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
  });
  return note.id;
}

function alwaysAssign(binPath: string): ClassifierLlm {
  return {
    modelName: "fake",
    complete: vi.fn(async () => JSON.stringify({
      existing_match: { bin_path: binPath, confidence: 0.9, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    })),
  };
}

describe("runClassifierBatch", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true }); });

  it("processes all unbinned notes up to the cap", async () => {
    createBin({ name: "Travel" });
    for (let i = 0; i < 5; i++) seed(`n-${i}`);
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 2, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(5);
    expect(summary.notes_auto_assigned).toBe(5);
    expect(summary.notes_pending).toBe(0);
  });

  it("aborts with ConcurrentRunError when a run is already in flight", async () => {
    createBin({ name: "Travel" });
    seed("n-1");
    const db = getDb();
    db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES ('preexisting', 'cron', ?)").run(Date.now());
    await expect(
      runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 1, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT })
    ).rejects.toThrow(/already in flight/i);
  });

  it("respects the cap", async () => {
    createBin({ name: "Travel" });
    for (let i = 0; i < 12; i++) seed(`n-${i}`);
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 3, rateLimitRpm: 100, cap: 5, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(5);
  });

  it("skips notes flagged classifier_skip = 1", async () => {
    createBin({ name: "Travel" });
    const skipId = seed("note-skip");
    getDb().prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(skipId);
    seed("note-eligible");
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 1, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/scripts/agent-classify.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/agent-classify.ts`**

Create `scripts/agent-classify.ts`:

```typescript
import { migrate, getDb } from "../lib/db";
import {
  acquireRunLock,
  finishClassifierRun,
  listUnclassifiedNotes,
  type ClassifierRunSummary,
  ConcurrentRunError,
} from "../lib/queries/classifications";
import { runClassifyOnce, type ClassifierLlm } from "../lib/classify/run";
import { createRateLimiter } from "../lib/classify/rate-limit";
import { getSetting } from "../lib/queries/app-settings";
import { resolveClassifyProfileId } from "../lib/classify/profile";
import { getProfile } from "../lib/llm/profiles";
import { buildClassifierLlm } from "../lib/classify/llm-adapter";

export interface BatchArgs {
  trigger: "cron" | "manual";
  llm: ClassifierLlm;
  profileId: string;
  concurrency: number;
  rateLimitRpm: number;
  cap: number;
  vaultPath?: string;     // override for tests
}

const DEFAULT_CAP = 100;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RPM = 45;

export async function runClassifierBatch(args: BatchArgs): Promise<ClassifierRunSummary> {
  const runId = acquireRunLock(args.trigger);
  const summary: ClassifierRunSummary = {
    notes_seen: 0,
    notes_auto_assigned: 0,
    notes_auto_created: 0,
    notes_pending: 0,
    notes_errored: 0,
    error_message: null,
  };
  try {
    const notes = listUnclassifiedNotes(args.cap);
    summary.notes_seen = notes.length;
    if (notes.length === 0) {
      finishClassifierRun(runId, summary);
      return summary;
    }
    const acquire = createRateLimiter({ rpm: args.rateLimitRpm });
    const { default: pLimit } = await import("p-limit");
    const matter = (await import("gray-matter")).default;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const limit = pLimit(args.concurrency);
    const vaultBase = args.vaultPath ?? process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

    await Promise.all(
      notes.map((n) =>
        limit(async () => {
          await acquire();
          let body = "";
          let frontmatter: Record<string, unknown> = {};
          try {
            const raw = fs.readFileSync(path.join(vaultBase, n.vault_path), "utf8");
            const parsed = matter(raw);
            body = parsed.content;
            frontmatter = parsed.data as Record<string, unknown>;
          } catch (e) {
            // file missing or unreadable — log and skip
            summary.notes_errored++;
            return;
          }
          const note = { id: n.id, title: n.title, frontmatter, body };
          const result = await runClassifyOnce({ note, llm: args.llm, runId, profileId: args.profileId });
          if (result.action === "auto_assign") summary.notes_auto_assigned++;
          else if (result.action === "auto_create_bin") summary.notes_auto_created++;
          else if (result.action === "pending") summary.notes_pending++;
          else if (result.action === "error") summary.notes_errored++;
        })
      )
    );
    finishClassifierRun(runId, summary);
    return summary;
  } catch (e) {
    summary.error_message = (e as Error).message;
    finishClassifierRun(runId, summary);
    throw e;
  }
}

export async function main(): Promise<void> {
  const db = getDb();
  migrate(db);

  const profileId = resolveClassifyProfileId();
  if (!profileId) {
    console.error("No classifier profile configured. Set classify.profile_id or llm.active_profile_id in settings.");
    process.exit(1);
  }
  const profile = getProfile(profileId);
  if (!profile) {
    console.error(`Classifier profile ${profileId} not found.`);
    process.exit(1);
  }

  const llm = buildClassifierLlm(profile);
  const rateLimitRpm = parseInt(getSetting("classify.rate_limit_rpm") ?? String(DEFAULT_RPM), 10);
  const concurrency = DEFAULT_CONCURRENCY;
  const cap = DEFAULT_CAP;

  try {
    const summary = await runClassifierBatch({
      trigger: "cron",
      llm,
      profileId,
      concurrency,
      rateLimitRpm,
      cap,
    });
    console.log(JSON.stringify(summary));
  } catch (e) {
    if (e instanceof ConcurrentRunError) {
      console.log("classifier already running; exiting cleanly");
      process.exit(0);
    }
    console.error("classifier failed:", (e as Error).message);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
```

- [ ] **Step 4: Add classify script to package.json**

Find `scripts` block in `package.json` and add:

```json
"classify": "tsx scripts/agent-classify.ts"
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run tests/scripts/agent-classify.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test 2>&1 | tail -10`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/agent-classify.ts tests/scripts/agent-classify.test.ts package.json
git commit -m "feat(classify): scripts/agent-classify.ts entry + npm run classify"
```

---

## Task 15: API — POST `/api/classify/run`

**Files:**
- Create: `app/api/classify/run/route.ts`
- Create: `tests/app/api/classify/run.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/app/api/classify/run.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, migrate, getDb } from "../../../../lib/db";
import { POST } from "../../../../app/api/classify/run/route";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-classify-run.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

vi.mock("../../../../scripts/agent-classify", () => ({
  runClassifierBatch: vi.fn(async () => ({
    notes_seen: 3,
    notes_auto_assigned: 2,
    notes_auto_created: 0,
    notes_pending: 1,
    notes_errored: 0,
    error_message: null,
  })),
}));

vi.mock("../../../../lib/classify/profile", () => ({
  resolveClassifyProfileId: vi.fn(() => "p1"),
}));

vi.mock("../../../../lib/llm/profiles", () => ({
  getProfile: vi.fn(() => ({
    id: "p1", name: "Haiku", type: "anthropic",
    default_model: "claude-haiku-4-5", api_key_encrypted: "x",
    max_context_tokens: 200000, created_at: "2026-01-01",
  })),
  getProfileSecret: vi.fn(() => "fake-key"),
}));

vi.mock("../../../../lib/classify/llm-adapter", () => ({
  buildClassifierLlm: vi.fn(() => ({ modelName: "fake", complete: vi.fn() })),
}));

describe("POST /api/classify/run", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("returns run summary on success", async () => {
    const res = await POST(new Request("http://localhost/api/classify/run", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes_seen).toBe(3);
    expect(body.notes_auto_assigned).toBe(2);
  });

  it("returns 503 when no profile is configured", async () => {
    const profile = await import("../../../../lib/classify/profile");
    vi.mocked(profile.resolveClassifyProfileId).mockReturnValueOnce(null);
    const res = await POST(new Request("http://localhost/api/classify/run", { method: "POST" }));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/app/api/classify/run.test.ts`

Expected: FAIL — route not found.

- [ ] **Step 3: Implement `app/api/classify/run/route.ts`**

Create `app/api/classify/run/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { runClassifierBatch } from "../../../../scripts/agent-classify";
import { resolveClassifyProfileId } from "../../../../lib/classify/profile";
import { getProfile } from "../../../../lib/llm/profiles";
import { buildClassifierLlm } from "../../../../lib/classify/llm-adapter";
import { ConcurrentRunError } from "../../../../lib/queries/classifications";
import { getSetting } from "../../../../lib/queries/app-settings";

const DEFAULT_RPM = 45;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_CAP = 100;

export async function POST(_req: Request): Promise<Response> {
  const profileId = resolveClassifyProfileId();
  if (!profileId) {
    return NextResponse.json(
      { error: "No classifier profile configured. Set one in Settings." },
      { status: 503 },
    );
  }
  const profile = getProfile(profileId);
  if (!profile) {
    return NextResponse.json({ error: `Classifier profile ${profileId} not found.` }, { status: 503 });
  }
  const llm = buildClassifierLlm(profile);
  const rpm = parseInt(getSetting("classify.rate_limit_rpm") ?? String(DEFAULT_RPM), 10);

  try {
    const summary = await runClassifierBatch({
      trigger: "manual",
      llm,
      profileId,
      concurrency: DEFAULT_CONCURRENCY,
      rateLimitRpm: rpm,
      cap: DEFAULT_CAP,
    });
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof ConcurrentRunError) {
      return NextResponse.json({ error: "classifier run already in flight" }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/app/api/classify/run.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/classify/run/route.ts tests/app/api/classify/run.test.ts
git commit -m "feat(classify): POST /api/classify/run — manual trigger endpoint"
```

---

## Task 16: API — `PATCH /api/classify/proposals/[id]` (accept/reject/edit-path)

**Files:**
- Create: `app/api/classify/proposals/[id]/route.ts`
- Create: `tests/app/api/classify/proposals.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/app/api/classify/proposals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { PATCH } from "../../../../app/api/classify/proposals/[id]/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { createBin } from "../../../../lib/queries/bins";
import { insertProposal, insertClassifierRun } from "../../../../lib/queries/classifications";
import { newId, nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-proposals.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/classify/proposals/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupProposal(): { proposalId: string; binId: string; noteId: string } {
  const bin = createBin({ name: "Travel" });
  const note = upsertVaultNote({
    vault_path: "note-a.md", title: "X", source: "obsidian",
    source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
  });
  const runId = insertClassifierRun({ trigger: "manual" });
  const proposalId = insertProposal({
    note_id: note.id,
    proposed_existing_bin_id: bin.id,
    existing_confidence: 0.5,
    proposed_new_bin_path: null,
    new_bin_rating: null,
    no_fit_reasoning: null,
    reasoning: "test",
    model: "haiku",
    profile_id: "p1",
    run_id: runId,
  });
  return { proposalId, binId: bin.id, noteId: note.id };
}

describe("PATCH /api/classify/proposals/[id]", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("accept assigns the existing bin and removes the proposal", async () => {
    const { proposalId, binId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "accept" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, binId)).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM classification_proposals WHERE id = ?").get(proposalId)).toBeUndefined();
  });

  it("reject increments classifier_attempts and removes the proposal", async () => {
    const { proposalId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "reject" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    const row = db.prepare("SELECT classifier_attempts FROM vault_notes WHERE id = ?").get(noteId) as { classifier_attempts: number };
    expect(row.classifier_attempts).toBe(1);
    expect(db.prepare("SELECT 1 FROM classification_proposals WHERE id = ?").get(proposalId)).toBeUndefined();
  });

  it("3 rejections set classifier_skip = 1", async () => {
    const { proposalId, noteId } = setupProposal();
    await PATCH(makeReq({ action: "reject" }), { params: { id: proposalId } });
    // re-create proposal twice more (each reject deletes it)
    for (let i = 0; i < 2; i++) {
      const newProposalId = insertProposal({
        note_id: noteId, proposed_existing_bin_id: null, existing_confidence: 0.4,
        proposed_new_bin_path: null, new_bin_rating: null, no_fit_reasoning: null,
        reasoning: "r", model: "haiku", profile_id: "p1", run_id: insertClassifierRun({ trigger: "manual" }),
      });
      await PATCH(makeReq({ action: "reject" }), { params: { id: newProposalId } });
    }
    const db = getDb();
    const row = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
  });

  it("accept-with-path creates a new bin chain and assigns it", async () => {
    const { proposalId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "accept_new_bin", path: "business/planning/okrs" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    const okrs = db.prepare("SELECT id FROM bins WHERE name = 'Okrs'").get() as { id: string };
    expect(okrs).toBeTruthy();
    const planning = db.prepare("SELECT id FROM bins WHERE name = 'Planning'").get();
    expect(planning).toBeTruthy();
    const business = db.prepare("SELECT id FROM bins WHERE name = 'Business'").get();
    expect(business).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, okrs.id)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/app/api/classify/proposals.test.ts`

Expected: FAIL — route not found.

- [ ] **Step 3: Implement `app/api/classify/proposals/[id]/route.ts`**

Create `app/api/classify/proposals/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { acceptProposal, rejectProposal, findExistingBinByParentAndSlug } from "../../../../../lib/queries/classifications";
import { createBin } from "../../../../../lib/queries/bins";
import { getDb } from "../../../../../lib/db";
import { newId, slugify } from "../../../../../lib/utils";
import { normalizeLlmPath } from "../../../../../lib/classify/paths";

interface AcceptBody { action: "accept" }
interface RejectBody { action: "reject" }
interface AcceptNewBinBody { action: "accept_new_bin"; path: string }
type Body = AcceptBody | RejectBody | AcceptNewBinBody;

function titleCase(slug: string): string {
  return slug.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function ensureBinChain(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) throw new Error("empty path");
  const db = getDb();
  let parentId: string | null = null;
  let lastId = "";
  for (const seg of segments) {
    const slug = slugify(seg);
    if (!slug) throw new Error(`invalid segment: ${seg}`);
    const existing = findExistingBinByParentAndSlug(parentId, slug);
    if (existing) {
      lastId = existing.id;
    } else {
      const newBinId = newId();
      db.prepare("INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order) VALUES (?, ?, ?, NULL, ?, ?)")
        .run(newBinId, titleCase(slug), parentId, new Date().toISOString(), 0);
      lastId = newBinId;
    }
    parentId = lastId;
  }
  return lastId;
}

export async function PATCH(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const body = (await req.json()) as Body;
  const proposalId = ctx.params.id;
  try {
    if (body.action === "accept") {
      const db = getDb();
      const proposal = db.prepare("SELECT proposed_existing_bin_id, proposed_new_bin_path FROM classification_proposals WHERE id = ?").get(proposalId) as {
        proposed_existing_bin_id: string | null; proposed_new_bin_path: string | null;
      } | undefined;
      if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
      let binId: string | null = proposal.proposed_existing_bin_id;
      if (!binId && proposal.proposed_new_bin_path) {
        binId = ensureBinChain(normalizeLlmPath(proposal.proposed_new_bin_path));
        acceptProposal({ proposalId, binId, isNewBin: true });
      } else if (binId) {
        acceptProposal({ proposalId, binId, isNewBin: false });
      } else {
        return NextResponse.json({ error: "proposal has no bin to accept" }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reject") {
      rejectProposal(proposalId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "accept_new_bin") {
      const path = normalizeLlmPath(body.path);
      if (!path) return NextResponse.json({ error: "invalid path" }, { status: 400 });
      const binId = ensureBinChain(path);
      acceptProposal({ proposalId, binId, isNewBin: true });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/app/api/classify/proposals.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/classify/proposals/[id]/route.ts tests/app/api/classify/proposals.test.ts
git commit -m "feat(classify): PATCH /api/classify/proposals/[id] — accept/reject/edit-path"
```

---

## Task 17: API — `POST /api/classify/auto/[id]/undo`

**Files:**
- Create: `app/api/classify/auto/[id]/undo/route.ts`
- Create: `tests/app/api/classify/undo.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/app/api/classify/undo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { POST } from "../../../../app/api/classify/auto/[id]/undo/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { createBin, assignNoteToBin } from "../../../../lib/queries/bins";
import { insertLogRow, insertClassifierRun } from "../../../../lib/queries/classifications";
import { newId, nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-undo.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

describe("POST /api/classify/auto/[id]/undo", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("removes the assignment and writes 'undone' row", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const bin = createBin({ name: "Travel" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "agent" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const logId = insertLogRow({
      note_id: note.id, action: "auto_assign", bin_id: bin.id, new_bin_path: null,
      existing_confidence: 0.9, new_bin_rating: null, reasoning: "r", model: "haiku",
      profile_id: "p1", run_id: runId, prior_log_id: null,
    });
    const res = await POST(new Request("http://localhost/", { method: "POST" }), { params: { id: logId } });
    expect(res.status).toBe(200);
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(note.id, bin.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM classification_log WHERE action = 'undone' AND prior_log_id = ?").get(logId)).toBeTruthy();
  });

  it("deletes auto-created bin if empty after undo", async () => {
    const note = upsertVaultNote({
      vault_path: "note-b.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const bin = createBin({ name: "AutoBin" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "agent" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const logId = insertLogRow({
      note_id: note.id, action: "auto_create_bin", bin_id: bin.id, new_bin_path: "auto-bin",
      existing_confidence: null, new_bin_rating: 0.85, reasoning: "r", model: "haiku",
      profile_id: "p1", run_id: runId, prior_log_id: null,
    });
    await POST(new Request("http://localhost/", { method: "POST" }), { params: { id: logId } });
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM bins WHERE id = ?").get(bin.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/app/api/classify/undo.test.ts`

Expected: FAIL — route not found.

- [ ] **Step 3: Implement route**

Create `app/api/classify/auto/[id]/undo/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { undoAutoClassification } from "../../../../../../lib/queries/classifications";

export async function POST(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  try {
    undoAutoClassification(ctx.params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/app/api/classify/undo.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/classify/auto/[id]/undo/route.ts tests/app/api/classify/undo.test.ts
git commit -m "feat(classify): POST /api/classify/auto/[id]/undo — reverse auto-classification"
```

---

## Task 18: API — `PATCH /api/notes/[id]/classifier-skip`

**Files:**
- Create: `app/api/notes/[id]/classifier-skip/route.ts`
- Create: `tests/app/api/notes/classifier-skip.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/app/api/notes/classifier-skip.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { PATCH } from "../../../../app/api/notes/[id]/classifier-skip/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-skip.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

describe("PATCH /api/notes/[id]/classifier-skip", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("sets classifier_skip = 1 when skip:true", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const req = new Request("http://localhost/", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip: true }) });
    const res = await PATCH(req, { params: { id: note.id } });
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(note.id) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
  });

  it("sets classifier_skip = 0 when skip:false", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    getDb().prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(note.id);
    const req = new Request("http://localhost/", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip: false }) });
    await PATCH(req, { params: { id: note.id } });
    const row = getDb().prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(note.id) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/app/api/notes/classifier-skip.test.ts`

Expected: FAIL — route not found.

- [ ] **Step 3: Implement route**

Create `app/api/notes/[id]/classifier-skip/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { setClassifierSkip } from "../../../../../lib/queries/classifications";

export async function PATCH(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const body = (await req.json()) as { skip: boolean };
  if (typeof body.skip !== "boolean") {
    return NextResponse.json({ error: "skip must be boolean" }, { status: 400 });
  }
  setClassifierSkip(ctx.params.id, body.skip);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/app/api/notes/classifier-skip.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/notes/[id]/classifier-skip/route.ts tests/app/api/notes/classifier-skip.test.ts
git commit -m "feat(classify): PATCH /api/notes/[id]/classifier-skip — toggle skip flag"
```

---

## Task 19: Indexer hook — set `classifier_skip = 1` when frontmatter `bins` is non-empty

**Files:**
- Modify: `scripts/vault-indexer.ts` (the existing `bins`-array branch around line 100-118)
- Modify or extend: `tests/scripts/vault-indexer.test.ts`

- [ ] **Step 1: Write failing test (extend existing test file)**

Add to `tests/scripts/vault-indexer.test.ts` (find the `describe` block for the indexer; add a new `it`):

```typescript
it("sets classifier_skip = 1 when frontmatter.bins resolves to existing bin(s)", async () => {
  // Setup: create a bin, write a note with frontmatter bins matching it.
  const bin = createBin({ name: "Travel", source_seed: "travel" });
  const fileContent = "---\nbins:\n  - travel\n---\n\nbody";
  const filePath = path.join(testVaultDir, "skip-me.md");
  fs.writeFileSync(filePath, fileContent);
  await runIndexerOnce(testVaultDir);
  const db = getDb();
  const note = db.prepare("SELECT classifier_skip FROM vault_notes WHERE vault_path = 'skip-me.md'").get() as { classifier_skip: number };
  expect(note.classifier_skip).toBe(1);
  const assignment = db.prepare("SELECT 1 FROM note_bins WHERE bin_id = ?").get(bin.id);
  expect(assignment).toBeTruthy();
});
```

(The exact harness names — `runIndexerOnce`, `testVaultDir` — must match what's already in the existing test file. Read it first; if names differ, adapt the test accordingly.)

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/scripts/vault-indexer.test.ts -t "classifier_skip"`

Expected: FAIL — `classifier_skip` is 0.

- [ ] **Step 3: Modify the indexer**

In `scripts/vault-indexer.ts`, find the existing block (~line 104):

```typescript
const isFirstIndex = existing === null;
if (isFirstIndex && Array.isArray(frontmatter.bins)) {
  const resolveBin = db.prepare(
    "SELECT id FROM bins WHERE source_seed = ? OR id = ? LIMIT 1"
  );
  for (const binRef of frontmatter.bins as unknown[]) {
    if (typeof binRef !== "string") continue;
    const row = resolveBin.get(binRef, binRef) as { id: string } | undefined;
    if (row) {
      assignNoteToBin({ note_id: note.id, bin_id: row.id, assigned_by: "auto" });
    }
  }
}
```

After the loop closes but still inside the `if (isFirstIndex && Array.isArray(frontmatter.bins))` block, add:

```typescript
  // v1.3: explicit frontmatter bin assignment means user has placed this note;
  // classifier should skip it on future runs.
  if (frontmatter.bins.length > 0) {
    db.prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(note.id);
  }
```

So the full block becomes:

```typescript
const isFirstIndex = existing === null;
if (isFirstIndex && Array.isArray(frontmatter.bins)) {
  const resolveBin = db.prepare(
    "SELECT id FROM bins WHERE source_seed = ? OR id = ? LIMIT 1"
  );
  for (const binRef of frontmatter.bins as unknown[]) {
    if (typeof binRef !== "string") continue;
    const row = resolveBin.get(binRef, binRef) as { id: string } | undefined;
    if (row) {
      assignNoteToBin({ note_id: note.id, bin_id: row.id, assigned_by: "auto" });
    }
  }
  if (frontmatter.bins.length > 0) {
    db.prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(note.id);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/scripts/vault-indexer.test.ts`

Expected: all indexer tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-indexer.ts tests/scripts/vault-indexer.test.ts
git commit -m "feat(classify): indexer sets classifier_skip when frontmatter.bins non-empty"
```

---

## Task 20: `/review` — Pending Proposals card component

**Files:**
- Create: `components/review/PendingProposalsCard.tsx`
- Create: `components/review/PendingProposalRow.tsx`
- Modify: `app/review/page.tsx` (add the card to the page)

- [ ] **Step 1: Implement `PendingProposalRow.tsx`**

Create `components/review/PendingProposalRow.tsx`:

```typescript
"use client";
import { useState } from "react";

export interface ProposalRowProps {
  id: string;
  noteTitle: string;
  noteId: string;
  existingBinPath: string | null;
  existingConfidence: number;
  newBinPath: string | null;
  newBinRating: number | null;
  reasoning: string;
  onChanged: () => void;
}

async function patch(id: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/classify/proposals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function setSkip(noteId: string, skip: boolean): Promise<void> {
  await fetch(`/api/notes/${noteId}/classifier-skip`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skip }),
  });
}

export function PendingProposalRow(props: ProposalRowProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(props.newBinPath ?? "");

  const isNewBin = props.newBinPath !== null;

  async function doAction(body: unknown): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await patch(props.id, body);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function doSkip(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await setSkip(props.noteId, true);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-white/10 rounded p-3 mb-2 bg-white/[0.02]">
      <div className="font-mono text-sm text-white/90">{props.noteTitle}</div>
      <div className="font-mono text-xs mt-1">
        {isNewBin ? (
          <>
            <span className="text-cyan-400">+ create</span>{" "}
            <span className="text-white/80">{props.newBinPath}</span>{" "}
            <span className="text-white/50">(rating {props.newBinRating?.toFixed(2)})</span>
            {props.existingBinPath && (
              <div className="text-white/50 mt-1">
                best existing match: {props.existingBinPath} ({props.existingConfidence.toFixed(2)})
              </div>
            )}
          </>
        ) : (
          <>
            <span className="text-white/60">→</span>{" "}
            <span className="text-white/80">{props.existingBinPath ?? "(no match)"}</span>{" "}
            <span className="text-white/50">({props.existingConfidence.toFixed(2)})</span>
          </>
        )}
        <button
          className="ml-3 text-white/50 hover:text-white/80"
          onClick={() => setShowReason((v) => !v)}
        >
          {showReason ? "hide reasoning" : "show reasoning ▾"}
        </button>
      </div>
      {showReason && (
        <div className="mt-2 text-xs text-white/70 italic">{props.reasoning}</div>
      )}
      {editingPath && (
        <div className="mt-2 flex gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <button
            disabled={busy}
            onClick={() => doAction({ action: "accept_new_bin", path: pathInput })}
            className="px-2 py-1 text-xs border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10"
          >
            Save
          </button>
          <button
            disabled={busy}
            onClick={() => setEditingPath(false)}
            className="px-2 py-1 text-xs border border-white/20 text-white/60 rounded"
          >
            Cancel
          </button>
        </div>
      )}
      {!editingPath && (
        <div className="mt-2 flex gap-2 text-xs">
          {isNewBin ? (
            <button disabled={busy} onClick={() => doAction({ action: "accept" })}
              className="px-2 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10">
              Accept &amp; create
            </button>
          ) : (
            <button disabled={busy} onClick={() => doAction({ action: "accept" })}
              className="px-2 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10">
              Accept
            </button>
          )}
          {isNewBin && (
            <button disabled={busy} onClick={() => setEditingPath(true)}
              className="px-2 py-1 border border-white/20 text-white/70 rounded hover:bg-white/5">
              Edit path…
            </button>
          )}
          <button disabled={busy} onClick={() => doAction({ action: "reject" })}
            className="px-2 py-1 border border-white/20 text-white/70 rounded hover:bg-white/5">
            Reject
          </button>
          <button disabled={busy} onClick={doSkip}
            className="px-2 py-1 border border-amber-500/30 text-amber-300/80 rounded hover:bg-amber-500/10">
            Stop trying
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `PendingProposalsCard.tsx`**

Create `components/review/PendingProposalsCard.tsx`:

```typescript
"use client";
import { PendingProposalRow } from "./PendingProposalRow";

export interface ProposalForCard {
  id: string;
  note_title: string;
  note_id: string;
  existing_bin_path: string | null;
  existing_confidence: number;
  new_bin_path: string | null;
  new_bin_rating: number | null;
  reasoning: string;
}

interface Props {
  proposals: ProposalForCard[];
  onChanged: () => void;
}

export function PendingProposalsCard({ proposals, onChanged }: Props): JSX.Element | null {
  if (proposals.length === 0) return null;
  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">
        Pending classifier proposals ({proposals.length})
      </h2>
      {proposals.map((p) => (
        <PendingProposalRow
          key={p.id}
          id={p.id}
          noteTitle={p.note_title}
          noteId={p.note_id}
          existingBinPath={p.existing_bin_path}
          existingConfidence={p.existing_confidence}
          newBinPath={p.new_bin_path}
          newBinRating={p.new_bin_rating}
          reasoning={p.reasoning}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Verify components compile**

Run: `npm run build 2>&1 | tail -10`

Expected: build succeeds (no TypeScript errors in new files).

- [ ] **Step 4: Commit**

```bash
git add components/review/PendingProposalRow.tsx components/review/PendingProposalsCard.tsx
git commit -m "feat(review): PendingProposalsCard with new-bin/existing-bin row variants"
```

---

## Task 21: `/review` — Recently Auto-Classified card

**Files:**
- Create: `components/review/RecentlyAutoClassifiedCard.tsx`

- [ ] **Step 1: Implement the card**

Create `components/review/RecentlyAutoClassifiedCard.tsx`:

```typescript
"use client";
import { useState } from "react";

export interface RecentRow {
  id: string;
  note_id: string;
  note_title: string;
  action: "auto_assign" | "auto_create_bin";
  bin_name: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  created_at: number;
}

interface Props {
  rows: RecentRow[];
  onChanged: () => void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function Row({ row, onChanged }: { row: RecentRow; onChanged: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [showReason, setShowReason] = useState(false);

  async function undo(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/classify/auto/${row.id}/undo`, { method: "POST" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const score =
    row.action === "auto_create_bin"
      ? row.new_bin_rating?.toFixed(2)
      : row.existing_confidence?.toFixed(2);

  return (
    <div className="border-b border-white/5 last:border-0 py-2">
      <div className="flex items-baseline justify-between font-mono text-sm">
        <span className="text-white/80">{row.note_title}</span>
        <span className="text-white/40 text-xs">
          auto · {row.action === "auto_create_bin" ? "created bin · " : ""}
          {relativeTime(row.created_at)}
        </span>
      </div>
      <div className="mt-1 font-mono text-xs flex items-center gap-2">
        {row.action === "auto_create_bin" ? (
          <span className="text-cyan-400">+ {row.new_bin_path} (created)</span>
        ) : (
          <>
            <span className="text-white/60">→</span>
            <span className="text-white/70">{row.bin_name}</span>
          </>
        )}
        <span className="text-white/40">({score})</span>
        <button onClick={() => setShowReason((v) => !v)} className="ml-auto text-white/40 hover:text-white/70">
          {showReason ? "hide" : "show reasoning ▾"}
        </button>
        <button disabled={busy} onClick={undo}
          className="text-white/40 hover:text-amber-300">
          Undo
        </button>
      </div>
      {showReason && row.reasoning && (
        <div className="mt-1 text-xs text-white/60 italic">{row.reasoning}</div>
      )}
    </div>
  );
}

export function RecentlyAutoClassifiedCard({ rows, onChanged }: Props): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">
        Recently auto-classified ({rows.length})
      </h2>
      {rows.map((r) => (
        <Row key={r.id} row={r} onChanged={onChanged} />
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/review/RecentlyAutoClassifiedCard.tsx
git commit -m "feat(review): RecentlyAutoClassifiedCard with quick-undo"
```

---

## Task 22: API — `GET /api/classify/proposals` and `GET /api/classify/recent`

**Files:**
- Create: `app/api/classify/proposals/route.ts`
- Create: `app/api/classify/recent/route.ts`
- Create: `app/api/classify/last-run/route.ts`

- [ ] **Step 1: Implement list endpoints**

Create `app/api/classify/proposals/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listPendingProposals } from "../../../../lib/queries/classifications";
import { listBins } from "../../../../lib/queries/bins";
import { buildBinTree, type BinRow } from "../../../../lib/classify/paths";

export async function GET(): Promise<Response> {
  const proposals = listPendingProposals();
  const bins = listBins() as BinRow[];
  const tree = buildBinTree(bins);
  const idToPath = new Map<string, string>();
  for (const [path, id] of tree.entries()) idToPath.set(id, path);
  const enriched = proposals.map((p) => ({
    id: p.id,
    note_id: p.note_id,
    note_title: p.note_title,
    existing_bin_path: p.proposed_existing_bin_id ? idToPath.get(p.proposed_existing_bin_id) ?? null : null,
    existing_confidence: p.existing_confidence,
    new_bin_path: p.proposed_new_bin_path,
    new_bin_rating: p.new_bin_rating,
    reasoning: p.reasoning,
  }));
  return NextResponse.json({ proposals: enriched });
}
```

Create `app/api/classify/recent/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listRecentlyAutoClassified } from "../../../../lib/queries/classifications";

export async function GET(): Promise<Response> {
  const rows = listRecentlyAutoClassified();
  return NextResponse.json({ rows });
}
```

Create `app/api/classify/last-run/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export async function GET(): Promise<Response> {
  const row = getDb()
    .prepare("SELECT * FROM classifier_runs ORDER BY started_at DESC LIMIT 1")
    .get();
  return NextResponse.json({ run: row ?? null });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/classify/proposals/route.ts app/api/classify/recent/route.ts app/api/classify/last-run/route.ts
git commit -m "feat(classify): GET endpoints for proposals, recent auto, last run"
```

---

## Task 23: Integrate cards into `/review` page + manual trigger button

**Files:**
- Modify: `app/review/page.tsx`

- [ ] **Step 1: Read existing review page**

Run: `cat app/review/page.tsx`

Expected: see the current review page (likely a server component with cards for uncategorized notes etc.). Identify where to insert the new sections — near the top, before existing cards.

- [ ] **Step 2: Add a client wrapper for the new sections**

Create `components/review/ClassifierSection.tsx`:

```typescript
"use client";
import { useEffect, useState, useCallback } from "react";
import { PendingProposalsCard, type ProposalForCard } from "./PendingProposalsCard";
import { RecentlyAutoClassifiedCard, type RecentRow } from "./RecentlyAutoClassifiedCard";

interface LastRun {
  started_at: number;
  finished_at: number | null;
  notes_seen: number;
  notes_auto_assigned: number;
  notes_auto_created: number;
  notes_pending: number;
  notes_errored: number;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function ClassifierSection(): JSX.Element {
  const [proposals, setProposals] = useState<ProposalForCard[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [pRes, rRes, lRes] = await Promise.all([
      fetch("/api/classify/proposals"),
      fetch("/api/classify/recent"),
      fetch("/api/classify/last-run"),
    ]);
    const pData = await pRes.json();
    const rData = await rRes.json();
    const lData = await lRes.json();
    setProposals(pData.proposals);
    setRecent(rData.rows);
    setLastRun(lData.run);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runNow(): Promise<void> {
    if (running) return;
    setRunning(true);
    setToast(null);
    try {
      const res = await fetch("/api/classify/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? `HTTP ${res.status}`);
      } else {
        setToast(`Classified ${data.notes_seen} — ${data.notes_auto_assigned} auto, ${data.notes_pending} pending, ${data.notes_errored} errored`);
      }
      await refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 font-mono text-sm">
        <button
          disabled={running}
          onClick={runNow}
          className="px-3 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10 disabled:opacity-50"
        >
          {running ? "Running…" : "Run classifier now"}
        </button>
        {lastRun && (
          <span className="text-white/50 text-xs">
            Last run: {relativeTime(lastRun.started_at)} — {lastRun.notes_seen} seen / {lastRun.notes_auto_assigned} auto / {lastRun.notes_pending} pending / {lastRun.notes_errored} errored
          </span>
        )}
        {toast && <span className="text-white/70 text-xs ml-auto">{toast}</span>}
      </div>
      <PendingProposalsCard proposals={proposals} onChanged={refresh} />
      <RecentlyAutoClassifiedCard rows={recent} onChanged={refresh} />
    </div>
  );
}
```

- [ ] **Step 3: Mount it in `app/review/page.tsx`**

Find the JSX in `app/review/page.tsx`. Add an import at the top:

```typescript
import { ClassifierSection } from "../../components/review/ClassifierSection";
```

And add `<ClassifierSection />` near the top of the rendered content (above the existing Uncategorized card or wherever feels natural for the page layout). Example:

```tsx
return (
  <main className="...">
    <h1 className="...">Review</h1>
    <ClassifierSection />
    {/* existing cards below */}
  </main>
);
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/review/page.tsx components/review/ClassifierSection.tsx
git commit -m "feat(review): integrate ClassifierSection — manual trigger + cards + last-run summary"
```

---

## Task 24: Settings UI — Classifier section

**Files:**
- Create: `components/settings/ClassifierSettings.tsx`
- Create: `app/api/settings/classify/route.ts`
- Modify: `app/settings/page.tsx` (mount the new component)

- [ ] **Step 1: Implement settings GET/PUT API**

Create `app/api/settings/classify/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSetting, setSetting, getSettingJson, setSettingJson } from "../../../../lib/queries/app-settings";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    profile_id: getSetting("classify.profile_id"),
    cron_interval_min: parseInt(getSetting("classify.cron_interval_min") ?? "10", 10),
    rate_limit_rpm: parseInt(getSetting("classify.rate_limit_rpm") ?? "45", 10),
    thresholds: getSettingJson("classify.thresholds") ?? {
      existing_min: 0.6,
      new_bin_floor: 0.75,
      new_bin_margin: 0.3,
    },
  });
}

interface PutBody {
  profile_id?: string | null;
  cron_interval_min?: number;
  rate_limit_rpm?: number;
  thresholds?: { existing_min: number; new_bin_floor: number; new_bin_margin: number };
}

export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json()) as PutBody;
  if (body.profile_id !== undefined) {
    if (body.profile_id === null) {
      setSetting("classify.profile_id", "");
    } else {
      setSetting("classify.profile_id", body.profile_id);
    }
  }
  if (typeof body.cron_interval_min === "number") {
    setSetting("classify.cron_interval_min", String(body.cron_interval_min));
  }
  if (typeof body.rate_limit_rpm === "number") {
    setSetting("classify.rate_limit_rpm", String(body.rate_limit_rpm));
  }
  if (body.thresholds) {
    setSettingJson("classify.thresholds", body.thresholds);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement `ClassifierSettings.tsx`**

Create `components/settings/ClassifierSettings.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";

interface Profile {
  id: string;
  name: string;
  type: string;
  default_model: string;
}

interface SettingsState {
  profile_id: string | null;
  cron_interval_min: number;
  rate_limit_rpm: number;
  thresholds: { existing_min: number; new_bin_floor: number; new_bin_margin: number };
}

const DEFAULTS = {
  cron_interval_min: 10,
  rate_limit_rpm: 45,
  thresholds: { existing_min: 0.6, new_bin_floor: 0.75, new_bin_margin: 0.3 },
};

export function ClassifierSettings(): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<SettingsState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, s] = await Promise.all([
        fetch("/api/llm/profiles").then((r) => r.json()),
        fetch("/api/settings/classify").then((r) => r.json()),
      ]);
      setProfiles(p.profiles ?? []);
      setState(s);
    })();
  }, []);

  if (!state) return <div className="text-white/50 text-sm">Loading…</div>;

  async function save(patch: Partial<SettingsState>): Promise<void> {
    setSaving(true);
    try {
      await fetch("/api/settings/classify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setState((s) => (s ? { ...s, ...patch } : s));
    } finally {
      setSaving(false);
    }
  }

  function resetThresholds(): void {
    void save({ thresholds: DEFAULTS.thresholds });
  }

  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">Classifier</h2>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Profile</span>
          <select
            value={state.profile_id ?? ""}
            onChange={(e) => save({ profile_id: e.target.value || null })}
            className="bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          >
            <option value="">(falls back to active chat profile)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.default_model}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Cron interval</span>
          <input
            type="number" min={1} max={60}
            value={state.cron_interval_min}
            onChange={(e) => save({ cron_interval_min: parseInt(e.target.value, 10) || 10 })}
            className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <span className="text-white/50 text-xs">minutes</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Rate limit</span>
          <input
            type="number" min={1} max={1000}
            value={state.rate_limit_rpm}
            onChange={(e) => save({ rate_limit_rpm: parseInt(e.target.value, 10) || 45 })}
            className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <span className="text-white/50 text-xs">requests / minute</span>
        </label>
        <div className="border-t border-white/10 pt-3">
          <div className="font-mono text-xs text-white/50 mb-2">Thresholds</div>
          {(["existing_min", "new_bin_floor", "new_bin_margin"] as const).map((k) => (
            <label key={k} className="flex items-center gap-3 mb-2">
              <span className="w-48 font-mono text-xs text-white/40">{k}</span>
              <input
                type="number" step={0.01} min={0} max={1}
                value={state.thresholds[k]}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (Number.isFinite(value)) {
                    save({ thresholds: { ...state.thresholds, [k]: value } });
                  }
                }}
                className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
              />
            </label>
          ))}
          <button
            onClick={resetThresholds}
            className="px-2 py-1 text-xs border border-white/20 text-white/60 rounded hover:bg-white/5"
          >
            Reset to defaults
          </button>
        </div>
        {saving && <div className="text-white/40 text-xs">Saving…</div>}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Mount in settings page**

Find `app/settings/page.tsx`. Add an import:

```typescript
import { ClassifierSettings } from "../../components/settings/ClassifierSettings";
```

And place `<ClassifierSettings />` somewhere in the rendered output (after the LLM profiles section is sensible).

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/settings/ClassifierSettings.tsx app/api/settings/classify/route.ts app/settings/page.tsx
git commit -m "feat(settings): Classifier section — profile, cron, rate limit, thresholds"
```

---

## Task 25: Documentation + manual smoke

**Files:**
- Modify: `README.md` (or wherever the dashboard's user-facing docs live)
- This task is exploratory — no failing test.

- [ ] **Step 1: Add a Classifier section to README**

Append to `README.md`:

```markdown
## Auto-classifier (v1.3)

The dashboard runs a classifier that places uncategorized notes into bins automatically.

**How it works.** Every cron tick (default: 10 min) the classifier reads notes that have no bin assignments, asks the LLM to pick a best-fit bin from your existing tree, and either auto-assigns (when confidence ≥ 0.6) or queues a proposal in `/review`. New bins can be auto-created when the agent rates them ≥ 0.75 AND meaningfully better than the closest existing bin.

**Settings.** Configure under Settings → Classifier:
- `Profile`: which LLM profile to use (Haiku, Kimi, etc.). Falls back to active chat profile if unset.
- `Cron interval`: minutes between automatic runs.
- `Rate limit`: requests/minute (default 45 — under Anthropic tier-1's 50 RPM cap).
- `Thresholds`: tune the auto-assign confidence and auto-create rating + margin gates.

**Running on demand.** Click `Run classifier now` in `/review` after a big sync, or run `npm run classify` from the CLI.

**Per-note control.**
- Frontmatter `bins:` (plural array) on a note pre-assigns it AND tells the classifier to skip that note forever.
- "Stop trying" button on any pending proposal flips the same flag.
- 3 rejected proposals on the same note auto-flip the flag.

**Disabling the classifier.** Clear the classify profile in Settings (set to `(falls back to active chat profile)` and also clear your active chat profile), or set `classify.cron_interval_min = 0` and don't trigger manually.
```

- [ ] **Step 2: Manual smoke walkthrough**

(This step is performed by the user, not automated. Document the steps but don't fail the task on smoke results — fix any issues found and commit separately.)

```text
1. Reset DB to clean state OR migrate an existing one:
   rm data/dashboard.db && npm run init-db   # OR keep existing — migrate runs automatically
2. Seed bins via the UI: create at least 3 top-level bins with known content focus.
3. Drop 5+ unbinned notes into the vault (e.g., manually create captures/foo.md files,
   sync a few Notion pages, etc.) and run npm run sync:vault to index.
4. Open /review. Pending Proposals + Recently Auto-Classified should be empty;
   Last run summary shows "never run yet".
5. Click "Run classifier now". Verify:
   - Toast shows summary
   - Both cards populate
   - Auto-assigned notes appear with their assigned bin in /bins
6. Right-click → reject one proposal. Verify it disappears and re-queues on next run.
7. Reject the same note's proposal 3x. Verify classifier_skip flips and the note
   no longer reappears in pending after manual runs.
8. Trigger an auto-create scenario: write a note with content that doesn't fit any
   existing bin, but with a clearly correct new-bin path. Verify a new bin is
   created with the note in it.
9. Click Undo on the auto-created assignment. Verify:
   - Assignment removed
   - Auto-created bin deleted (since now empty)
   - Note returns to uncategorized state
10. Add bins: ["travel"] to a note's frontmatter, save, run npm run sync:vault.
    Verify classifier_skip = 1 in the DB AND the bin assignment was applied.
11. Concurrent-run guard: open two terminals; in one, run npm run classify; in the
    other, click "Run classifier now" while the first is still running. Verify the
    second gets a 409 / "already in flight" toast.
12. Tune thresholds in Settings (e.g. existing_min = 0.8). Verify next run
    queues more notes as pending.
```

- [ ] **Step 3: Run full suite + lint + typecheck + build**

```bash
npm test 2>&1 | tail -10
npm run lint 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -10
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(v1.3): classifier README section + smoke walkthrough"
```

---

## Wrap-up

- [ ] **Push branch**

```bash
git push -u origin feature/v1.3-auto-classify
```

- [ ] **Open PR (optional, when smoke passes)**

```bash
gh pr create --title "v1.3 — whole-note auto-classify" --body "$(cat <<'EOF'
## Summary
- Adds LLM-powered classifier that drains unbinned notes into the existing bin tree
- Runs on cron + manual trigger from /review
- Threshold-gated auto-assign (≥0.6 confidence) and auto-create-bin (≥0.75 rating + 0.3 margin + parent exists)
- New /review surfaces: Pending Proposals + Recently Auto-Classified (with quick-undo)
- Settings: profile, cron interval, rate limit, thresholds
- New migration runner in lib/db.ts (PRAGMA user_version)

## Spec
docs/superpowers/specs/2026-04-26-v13-auto-classify-design.md (cb91367)

## Test plan
- [x] All unit + integration tests pass
- [ ] Manual smoke walkthrough (see plan §25)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Update CLAUDE.md to reflect v1.3 shipping**

Edit the "Current state" section in CLAUDE.md once smoke is signed off and PR merged.

---

## Self-review checklist

- All spec sections (1–12) have at least one task implementing them
- No "TBD" / "TODO" / "implement later" / "add appropriate handling" placeholders
- Type names consistent across tasks (`ClassifierLlm`, `Decision`, `Thresholds`, `BatchArgs`, `RunArgs`)
- Migration runner pattern (`migrate(db, dir?)`) used identically in `getDb`, `init-db`, and `agent-classify`
- Frontmatter key is `bins` (plural array) everywhere — never `bin` singular
- Every API route has at least one test
- Every pure module has full branch coverage in tests
- Path normalization (`normalizeLlmPath`) applied consistently before any `binTree` lookup
- Pre-flight bin-existence check at commit time uses `parent_bin_id IS ?` + JS slugify filter (no slug column)
- Concurrent-run guard uses `BEGIN IMMEDIATE` + orphan sweep
- Per-run cap of 100 enforced via `LIMIT ?` on the unclassified-notes query
