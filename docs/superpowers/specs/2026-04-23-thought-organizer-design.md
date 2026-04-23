# Thought Organizer — v1 Design Spec

**Date:** 2026-04-23
**Revision:** v2 (incorporating Kimi audit feedback + simplified indexer)
**Status:** Approved, ready for implementation planning
**Working name:** "Thought Organizer" (rename TBD before release)

---

## 1. Problem & Motivation

The user runs a creative/dev agency with work scattered across Notion (structured), Apple Notes (quick captures), filesystem notes, and soon Obsidian. Current pain points:

- **Capture friction** — thoughts go into whichever app is open, then disappear
- **Cross-tool search** — "what did I write about X" doesn't work across Notion / Obsidian / Notes
- **The weekly review never happens** — capture is easy, organization rots
- **No surfacing** — tools store, they don't tell you what to look at next
- **Agent-unfriendly state** — no canonical place for an AI agent to query

The existing dashboard is a Next.js + SQLite command center accessed via Tailscale on a Mac Mini. Its current `notes` table is empty and schema-thin (no full content, no cross-source linkage, no search).

**Goal:** turn the dashboard into a viewport + organizing layer over a canonical knowledge vault, so the user's thoughts are findable, organized by topic, and eventually queryable by an AI agent.

---

## 2. Architectural Vision

Three layers, each with one job. The architecture is inspired by two specific patterns validated by current practitioner reels:

- **"Second brain with Claude + Obsidian"** (Rui Fu) — Obsidian vault + Claude Code operating on it directly. Two folders (`raw_sources/`, `wiki/`) and a CLI agent.
- **"Consolidated DB beats fan-out MCP"** (Angus) — sync all data into one canonical store, expose one simple tool that queries that store.

Both validate the same principle: **consolidate into one canonical store, then operate on it.**

### 2.1 Vault — the brain

- Location: `~/Vault/` on the Mac Mini
- Format: plain markdown files, organized in folders
- Sync: iCloud Drive (200 GB tier) across Mac Mini, MacBook, iPhone
- Editable in Obsidian (app) on any device; also editable by Claude Code when pointed at the folder
- **Canonical home for all unstructured content** — user-written notes, mirrored Notion content, quick captures, future Apple Notes sync

### 2.2 Dashboard — viewport + metadata

- Next.js app on the Mac Mini, accessed via Tailscale
- Access control is enforced at the network layer by Tailscale's device-level SSO auth (Google/Apple/GitHub). External devices cannot reach the dashboard. No application-level auth is needed, and adding one would not improve security. See §12 for threat model.
- SQLite holds: bin hierarchy, bin↔note mappings, FTS5 search index over vault content, the existing structured data (clients, projects, agents, sync_status)
- **Never owns note content.** Reads content from vault files on demand. Owns organization and metadata only.
- UI surfaces: bin browser, cross-source search, review panel, quick capture, existing client/project pages

### 2.3 Agent layer — deferred to v3, designed-for now

Two entry points, same substrate:

- **Power user**: `cd ~/Vault && claude` — Claude Code operates on the files directly (Rui Fu pattern)
- **Ambient**: dashboard chat box on Tailscale, sends queries to the vault via Claude API

Both read vault files directly. They query dashboard SQLite only for structured metadata ("what client owns Project Alpha?"). v3 adds: auto-classification on capture, weekly health check, retrieval chat.

---

## 3. Data Model

### 3.1 Vault structure

```
~/Vault/
├── notes/                     # user's own writing
│   ├── daily/                 # YYYY-MM-DD.md daily notes (Obsidian convention)
│   ├── ideas/
│   ├── drafts/
│   └── ...any folders user wants
├── captures/                  # quick-capture drops from the dashboard
│   └── 2026-04-23-14-32-<slug>.md
├── notion-sync/               # mirror of Notion, written by sync-notion.ts
│   ├── <db-name>/
│   │   └── <page-title>.md    # each Notion page = one md file with frontmatter
│   └── _meta/                 # sync state
├── wiki/                      # agent's organized outputs (empty in v1, populated in v3)
└── .obsidian/                 # Obsidian app config — dashboard never touches this
```

**Frontmatter convention** — every file written by the dashboard or sync scripts:

```yaml
---
source: notion | obsidian | capture | apple-notes
source_id: <notion page id, apple note id, or empty for native>
source_url: <link back to source system>
created_at: 2026-04-23T14:32:00Z
last_synced_at: 2026-04-23T14:35:00Z
tags: [reels, tokyo]
bins: [bin-ulid-1, bin-ulid-2]
---
```

User-written notes in `notes/` may have any frontmatter (or none) — parser accepts what's present, doesn't require fields.

### 3.2 Dashboard SQLite schema changes

The existing `notes` table is dropped (the DB has been verified empty — no production data to migrate). New tables:

```sql
-- Drop the existing notes table — content now lives in vault files
DROP TABLE notes;

CREATE TABLE vault_notes (
    id TEXT PRIMARY KEY,              -- ulid
    vault_path TEXT UNIQUE NOT NULL,  -- relative path from ~/Vault
    title TEXT NOT NULL,              -- from frontmatter > first heading > filename
    source TEXT NOT NULL,             -- 'obsidian' | 'notion' | 'capture' | 'apple-notes'
    source_id TEXT,                   -- Notion page id, etc. NULL for obsidian/capture
    source_url TEXT,
    content_hash TEXT NOT NULL,       -- xxhash of file contents for change detection
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,        -- filesystem mtime
    last_indexed_at TEXT NOT NULL,
    client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

-- FTS5 virtual table for cross-source search.
-- CONTENTLESS — the indexer explicitly writes rows here with the same rowid
-- as vault_notes. This avoids the need for external-content triggers and
-- matches the reality that note content lives in vault files, not the DB.
CREATE VIRTUAL TABLE vault_notes_fts USING fts5(
    title, content, tags,
    tokenize = 'porter unicode61 remove_diacritics 1'
);

-- Bins — hierarchical organizing primitive
CREATE TABLE bins (
    id TEXT PRIMARY KEY,              -- ulid
    name TEXT NOT NULL,
    parent_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
    source_seed TEXT UNIQUE,          -- e.g. 'obsidian:Content/Reels' if auto-created
    created_at TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Junction — a note can live in multiple bins
CREATE TABLE note_bins (
    note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
    bin_id TEXT NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL,
    assigned_by TEXT NOT NULL CHECK (assigned_by IN ('auto', 'manual', 'agent')),
    PRIMARY KEY (note_id, bin_id)
);

-- Tags extracted from frontmatter and inline #hashtags
CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

-- Indexes
CREATE INDEX idx_vault_notes_source ON vault_notes(source);
CREATE INDEX idx_vault_notes_modified ON vault_notes(modified_at);
CREATE INDEX idx_vault_notes_client ON vault_notes(client_id);
CREATE INDEX idx_vault_notes_project ON vault_notes(project_id);
CREATE UNIQUE INDEX idx_vault_notes_source_id ON vault_notes(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_bins_parent ON bins(parent_bin_id);
CREATE INDEX idx_note_bins_note ON note_bins(note_id);
CREATE INDEX idx_note_bins_bin ON note_bins(bin_id);
CREATE INDEX idx_note_tags_tag ON note_tags(tag);

-- Extend existing sync_status with a cursor field for resumable delta sync
ALTER TABLE sync_status ADD COLUMN cursor TEXT;
```

**Key decisions:**
- `vault_notes` is an index over the vault. Content lives in files.
- `vault_notes_fts` is **contentless FTS5** — the indexer writes to it directly using the same rowid as `vault_notes`. This avoids triggers and matches where the data actually lives.
- Bins are a tree (`parent_bin_id`); notes live in multiple bins (`note_bins`).
- `source_seed` is UNIQUE so `sync-obsidian.ts` can safely re-run without creating duplicate auto-bins.
- `source_id` is partial-unique (only where not null) so Notion pages deduplicate correctly even after renames.
- `assigned_by` is CHECK-constrained to catch typos.
- `sync_status.cursor` stores per-script resume state (Notion's `last_edited_time`, etc).

### 3.3 Migration: files that reference the old `notes` table

Dropping `notes` breaks the following files. Each must be updated in the Phase 1 migration step:

| File | Reference | Action |
|---|---|---|
| `lib/schema.sql` | `CREATE TABLE notes` | Replace with new schema above |
| `lib/types.ts` | `Note` interface, `NoteSource` type | Rename/rework for `VaultNote` |
| `lib/queries/notes.ts` | All CRUD functions | Rewrite for `vault_notes` |
| `tests/lib/queries/notes.test.ts` | Old query tests | Rewrite against new API |
| `app/notes/page.tsx` | `listNotes(200)` | Rebuild for bin browser |
| `app/clients/[slug]/page.tsx` | `listNotesByClient(client.id, 5)` | Update to new query name |
| `app/api/notes/route.ts` | `listNotes(limit)` | Rewrite for new shape |
| `app/api/clients/[slug]/route.ts` | `listNotesByClient(client.id)` | Update to new query name |

The DB file (`data/dashboard.db`) is confirmed empty for `notes` — no data migration step needed.

### 3.4 What's intentionally NOT in SQLite

- Note content (lives in vault files, read on demand)
- Full vault tree (index only what we surface)
- Wikilinks / backlinks (deferred to v2 — lazy-parsed from vault when needed)

---

## 4. Sync Pipeline

Three scripts, each with one responsibility. All follow the existing `upsertX + recordSyncRun + closeDb` pattern.

**Architectural note:** the indexer is a cron-driven scan, not a long-running daemon. This deliberately avoids launchd lifecycle, chokidar / FSEvents / iCloud interaction edge cases, and silent daemon deaths. The trade-off is up to ~5 min of lag for Obsidian edits to surface in the dashboard — acceptable since iCloud itself already adds 30s–2min of sync latency, and the user isn't refreshing the dashboard continuously.

### 4.1 `scripts/vault-indexer.ts` — cron scan (every 5 min)

- Walks `~/Vault/**/*.md` with `fast-glob`, excluding `.obsidian/**`, `.trash/**`, `.git/**`, and `**/*.icloud` placeholder stubs
- For each file:
  - Read mtime. If `mtime <= last_indexed_at` for the existing `vault_notes` row, skip.
  - Read file contents, parse frontmatter (`gray-matter`), compute `xxhash` of content.
  - If `xxhash == content_hash` in DB, update only `last_indexed_at` and `modified_at`; don't reparse.
  - Else: upsert `vault_notes` by `vault_path`, refresh `vault_notes_fts` row (DELETE + INSERT with same rowid), upsert `note_tags` from frontmatter `tags` + inline `#hashtags`.
  - On **first index of a file** (no existing `vault_notes` row): if frontmatter contains `bins: [...]`, create `note_bins` rows with `assigned_by='auto'`. On subsequent re-indexes, **do not touch** `note_bins` — see §7.3.
- Detects deletions: any `vault_notes.vault_path` not seen in the scan gets soft-deleted (`deleted_at` timestamp); hard-delete on the next scan if still missing.
- Written as an idempotent one-shot script. Invoked by cron every 5 min (logs to `~/Library/Logs/vault-indexer.log`) and also directly by the capture flow (see §6) for immediate-index on new captures.
- Records run in `sync_status(sync_name='vault-indexer', duration_ms, status, cursor=NULL)`.

### 4.2 `scripts/sync-notion.ts` — cron poller (every 15 min)

- Uses `@notionhq/client` (pinned to API version `2026-03-11`) with an internal integration token from `.env.local`.
- For each configured database (list read from settings), query pages where `last_edited_time > sync_status.cursor` (ISO timestamp stored per-database in `sync_cursors` map within `sync_status.cursor` column as JSON, keyed by database id).
- For each changed page:
  - Fetch block tree recursively (walk `has_children` via `/v1/blocks/:id/children`).
  - Convert to markdown (paragraph / heading / list / code / quote / toggle → md; columns/layouts are flattened).
  - **Upsert by `source_id`, not `vault_path`.** Look up existing `vault_notes` row by Notion page ID:
    - If exists and slug changed: compute new `vault_path`, rename file atomically on disk (`fs.rename` from old path to new), update row with new `vault_path`, `content_hash`, `last_synced_at`.
    - If exists and slug unchanged: overwrite file contents via atomic rename (write `.tmp`, rename), update row.
    - If not exists: write file, insert row.
  - Frontmatter: `source: notion`, `source_id`, `source_url`, `last_synced_at`, `tags: [<from Notion multi-select>]`.
- Rate limiting: token bucket at 2.5 req/s with jitter; exponential backoff on 429s (1s → 2s → 4s → 8s, max 60s).
- Updates cursor only after all pages for a database are successfully synced.
- Vault indexer picks up the new/changed files on its next pass.

### 4.3 `scripts/sync-obsidian.ts` — one-time seed (re-runnable)

- Runs the same scan as `vault-indexer.ts`, idempotently backfilling `vault_notes` rows for any unindexed file.
- **Bin auto-seeding** (runs only on first execution OR when user triggers "Re-seed bins from folders" in settings):
  - For each top-level folder in `~/Vault/notes/`, create a bin with `source_seed='obsidian:<folder-name>'` (UNIQUE constraint prevents duplicates on re-run).
  - For each Notion database mirrored in `~/Vault/notion-sync/`, create a bin with `source_seed='notion:<db-name>'`.
  - Assign existing notes to bins based on their folder location with `assigned_by='auto'`.
- **Re-run safety:** bins with existing `source_seed` are skipped. Notes are assigned only if no `note_bins` row for that `(note_id, bin_id)` already exists — so manual reassignments are never clobbered.

### 4.4 Authentication

- Notion: user creates an internal integration in Notion workspace settings, shares the target databases/pages with it, drops the `secret_xxx` token in `.env.local` (v1) or via Settings page (v1.1).
- No OAuth needed — single user, single workspace.

---

## 5. UI Surfaces

### 5.1 Modified pages

- **`/notes`** — becomes the bin browser + search
  - Left sidebar: tree of bins (nested), with note counts. **Empty state**: "No bins yet. Run Settings → Initial vault scan."
  - Main area: list of notes in the selected bin, faceted filters above (source, tag, client, date range)
  - Top bar: global FTS5 search input
  - "No bin selected" default view: recent notes across all bins

- **Sidebar (global)** — gains a "Capture" button with keyboard shortcut (default `Cmd+Shift+C` — avoids collision with browser `Cmd+K` in Chrome/Firefox) that opens the Quick Capture modal from anywhere in the dashboard.

### 5.2 New pages

- **`/notes/[id]`** — note detail
  - Parsed markdown via **`react-markdown@^9`** with **`remark-gfm@^4`** (tables, task lists, strikethrough)
  - Read-only in v1; editing happens in Obsidian via an "Open in Obsidian" link using the `obsidian://` URL scheme
  - Frontmatter panel (metadata)
  - "In bins:" chips with remove button
  - "Add to bin" autocomplete
  - Source link: click-through to Notion URL, or "Open in Obsidian"
  - v2: "Linked from" (backlinks) panel

- **`/review`** — daily/weekly review surface
  - **Today** — notes modified today, today's daily note if it exists
  - **Uncategorized** — notes with no bin assignment
  - **Stale bins** — bins with no new notes in 30+ days

### 5.3 New components

- `BinTree` — recursive nested list with expand/collapse, click-to-select. v1.5 adds drag-reorder.
- `NoteList` — source icon, title, tags, bin chips, modified date
- `QuickCapture` — modal: textarea + bin picker (autocomplete over existing bins, can create new inline) + optional tag input. Submit writes markdown file to vault AND triggers an immediate one-shot indexer pass on the new file.
- `SearchBar` — FTS5-backed, keyboard-first, result preview with highlighted matches via `snippet()`

### 5.4 Settings page additions

- `VAULT_PATH` — default `~/Vault`, editable
- `NOTION_TOKEN` — paste integration secret
- `NOTION_SYNC_TARGETS` — list of Notion database IDs to sync; user picks
- `CAPTURE_FOLDER` — default `captures/`
- "Run initial vault scan" button — triggers `sync-obsidian.ts` + bin auto-seeding
- "Reindex all" button — forces a full `vault-indexer.ts` scan ignoring mtime
- "Re-seed bins from folders" button — re-runs bin auto-seeding (idempotent)

### 5.5 Dependencies (new, pinned)

```
npm install \
  @notionhq/client@^5.12 \
  gray-matter@^4.0 \
  fast-glob@^3.3 \
  @node-rs/xxhash@^1.7 \
  react-markdown@^9.0 \
  remark-gfm@^4.0
```

Existing deps (`better-sqlite3`, `next`, `react`, `ulid`, `tsx`) are unchanged.

---

## 6. Capture Flow

1. User hits `Cmd+Shift+C` anywhere in dashboard → `QuickCapture` modal opens
2. User types thought, picks a bin (autocomplete, can create new bin inline), optionally adds tags
3. On submit:
   - Dashboard generates a file at `~/Vault/captures/2026-04-23-14-32-<slug>.md` where `<slug>` is the first 5 words of the capture text (URL-slugified), falling back to `capture` if the text is too short.
   - Frontmatter includes `source: capture`, `created_at: <iso>`, `bins: [<bin-id>]`, `tags: [...]`
   - Body is the user's text
   - Written via atomic rename (`.tmp` file + `fs.rename`)
4. `POST /api/notes/capture` invokes `vault-indexer.ts` for just this one file (synchronous, ~100ms), which creates the `vault_notes` row, `vault_notes_fts` row, `note_bins` row (from `bins: [...]` in frontmatter, `assigned_by='auto'`), and any `note_tags`.
5. API returns 200 with the new note ID
6. User sees toast: "Captured to <bin-name>"

**Invariant:** captures are markdown files first, DB records second. If the dashboard or indexer fails after writing the file but before indexing, the next cron scan picks it up automatically. If iCloud is slow, other devices get the file later. No fragile paths.

---

## 7. Search, Bins, and Frontmatter Invariant

### 7.1 Search

- `vault_notes_fts` indexes title, content (plain-text extracted from markdown by the indexer), tags
- Search API: `GET /api/notes/search?q=<query>&bin=<bin-id>&source=<source>&tag=<tag>`
- Results include snippet with highlighted matches (FTS5 `snippet()` function)

### 7.2 Bin operations

- `POST /api/bins` — create bin with optional `parent_bin_id`
- `PATCH /api/bins/[id]` — rename, reparent, reorder
- `DELETE /api/bins/[id]` — with confirmation; cascades to children and `note_bins`. The confirmation dialog must enumerate child bins and affected notes.
- `POST /api/bins/[id]/assign` — add note to bin with `assigned_by='manual'` (upsert; no-op if already assigned)
- `DELETE /api/bins/[id]/assign/[note-id]` — remove note from bin

### 7.3 Frontmatter ↔ note_bins invariant (critical)

**Frontmatter `bins: [...]` is the seed source on file creation only. After the first index, `note_bins` is the source of truth.**

Concretely:

- When the indexer sees a file for the **first time** (no existing `vault_notes` row): read `bins: [...]` from frontmatter, create `note_bins` rows with `assigned_by='auto'`.
- When the indexer sees a file that **already has a `vault_notes` row**: do NOT touch `note_bins`. Reparse frontmatter for title, tags, source metadata only. Even if the user edits `bins: [...]` in the file's frontmatter directly (e.g. in Obsidian), those edits are ignored by the indexer.
- When the user adds/removes a bin via the dashboard UI: update `note_bins` only. The file's frontmatter is NOT rewritten. This means a note's frontmatter may become stale relative to its actual bin memberships — this is accepted as the v1 trade-off.
- When the user runs "Re-seed bins from folders" in settings: the indexer may add `assigned_by='auto'` rows from frontmatter for notes that currently have NO `note_bins` rows at all, but never from notes with existing rows (of any `assigned_by` type).

**Why this policy:** the alternative — making the UI rewrite frontmatter on every bin change — requires safe round-trip frontmatter serialization (order preservation, comment preservation), is error-prone, and creates subtle sync races between the UI writer and the indexer. Keeping frontmatter seed-only removes the entire class of bug.

**Documented in the UI:** the note detail page shows a small info badge next to "In bins" explaining: *"Bin memberships are managed in the dashboard. Editing the `bins:` field in the markdown file has no effect after initial creation."*

### 7.4 Bin merging

- User can merge bins from different sources (e.g., Notion "Reels" DB bin + Obsidian "Content/Reels/" folder bin into one bin)
- Merge operation: move all `note_bins` rows from source bin to target bin, delete source bin
- Safe because notes are referenced by file path, not folder — merging bins doesn't move files

---

## 8. Review Surface

`/review` computes and displays:

- **Today** — `SELECT * FROM vault_notes WHERE modified_at >= start_of_day ORDER BY modified_at DESC` (uses `idx_vault_notes_modified`)
- **Uncategorized** — `SELECT * FROM vault_notes WHERE id NOT IN (SELECT note_id FROM note_bins) ORDER BY modified_at DESC`
- **Stale bins** — `SELECT bins.*, MAX(vault_notes.modified_at) as last_activity FROM bins LEFT JOIN note_bins ON ... LEFT JOIN vault_notes ON ... GROUP BY bins.id HAVING last_activity < date('now', '-30 days') OR last_activity IS NULL`

---

## 9. Agent Integration Points (v3 prep)

v1 designs for v3 without building it:

- **Vault path is discoverable** — `VAULT_PATH` env var; agent can find files
- **Frontmatter is canonical for metadata** — agent can read source, tags, and initial bins from the file itself (but must query the dashboard for current bin memberships, since frontmatter is seed-only per §7.3)
- **Write path is safe** — agent writes files the same way the dashboard does (atomic rename, frontmatter conventions)
- **Dashboard API exposes structured data** — `GET /api/clients/[id]`, `GET /api/projects/[id]`, `GET /api/notes/[id]/bins` give agent context for routing decisions

v3 will add:
- `scripts/agent-classify.ts` — on new captures without manual bin overrides, ask Claude to suggest bins; present suggestions in review surface
- `scripts/agent-health-check.ts` — weekly cron; ask Claude to find contradictions, stale info, uncategorized-too-long notes; write report to `~/Vault/wiki/health-check-<date>.md`
- `/chat` page — Tailscale-accessible chat that queries the vault via Claude API

---

## 10. Rollout Plan

### Phase 1 — Foundation (v1.0)

1. **Schema migration.** Drop `notes`, add `vault_notes`, `bins`, `note_bins`, `note_tags`, `vault_notes_fts`, all indexes, extend `sync_status.cursor`. Update the 8 dependent files per §3.3.
2. **Query layer.** Rewrite `lib/queries/notes.ts` → `lib/queries/vault-notes.ts` + `lib/queries/bins.ts`. Add FTS search wrapper. Update tests.
3. **`scripts/vault-indexer.ts`** — file scan + parse + upsert + FTS index management. Runnable manually. Include a `--file <path>` flag for single-file immediate mode (used by capture).
4. **`scripts/sync-obsidian.ts`** — seed scan + bin auto-creation with `source_seed` UNIQUE dedup.
5. **API routes**: `GET/POST /api/notes`, `GET /api/notes/[id]`, `GET/POST /api/bins`, `PATCH/DELETE /api/bins/[id]`, `POST /api/bins/[id]/assign`, `DELETE /api/bins/[id]/assign/[note-id]`, `GET /api/notes/search`. Update `GET /api/notes` and `GET /api/clients/[slug]` callers.
6. **`/notes` page rebuild:** `BinTree` + `NoteList` + `SearchBar`. Include empty-state UI for "no bins yet."
7. **`/notes/[id]` detail page** with `react-markdown` + `remark-gfm`.

### Phase 2 — Capture + Notion sync (v1.1)

8. **Quick Capture modal** + hotkey + `POST /api/notes/capture` (writes file, invokes `vault-indexer.ts --file <path>` synchronously).
9. **`scripts/sync-notion.ts`** — initial pull + delta poll with source_id-based upsert and atomic rename on slug changes.
10. **Settings page additions** (vault path, Notion token, sync targets, three action buttons).
11. **`/review` page** with Today / Uncategorized / Stale queries.

### Phase 3 — Deploy (v1.2)

12. **Cron entries** on Mac Mini:
    ```
    */5 * * * * cd ~/Dashboard && /usr/local/bin/node node_modules/.bin/tsx scripts/vault-indexer.ts >> ~/Library/Logs/vault-indexer.log 2>&1
    */15 * * * * cd ~/Dashboard && /usr/local/bin/node node_modules/.bin/tsx scripts/sync-notion.ts >> ~/Library/Logs/sync-notion.log 2>&1
    0 3 * * * tar -czf ~/Backups/vault-$(date +\%Y\%m\%d).tar.gz ~/Vault
    0 3 * * * cp ~/Dashboard/data/dashboard.db ~/Dashboard/data/backups/dashboard-$(date +\%Y\%m\%d).db
    ```
13. **launchd plist for the Next.js app itself** (as specified in the existing README — no daemon indexer needed).
14. **Deploy to Mac Mini**, verify Tailscale access end-to-end, verify first cron cycles complete and populate data.

---

## 11. Deferred to v2+

- Apple Notes sync (requires Full Disk Access + protobuf decoding; high effort, B-tier value)
- Bidirectional Notion write-back beyond captures (editing mirrored Notion notes in the dashboard)
- Wikilink parsing + backlinks panel
- Drag-and-drop bin reorganization
- In-dashboard note editing (editing happens in Obsidian for v1)
- Agent layer (auto-classify, health check, chat) — entire v3
- Graph visualization of note connections
- Note templates
- Export workflows
- Frontmatter round-trip (UI bin changes rewriting the file)

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| iCloud sync races with Mini background writes → conflict files | Atomic-rename writes everywhere; sync scripts skip files modified in last 30s; cron jobs scheduled so Notion sync (every 15 min) and indexer (every 5 min) don't overlap routinely; heavy backup at 3 AM |
| Cron job fails silently (indexer or Notion sync) | Dashboard home page health card: red dot if `sync_status.{name}.last_run_at` is older than 2× its expected interval; logs at `~/Library/Logs/` for postmortem |
| Notion rate limits during large initial backfill | Token bucket at 2.5 req/s, exponential backoff on 429, resumable via `sync_status.cursor` |
| Notion page rename → orphan file + duplicate row | Upsert by `source_id` (not `vault_path`); partial unique index on `source_id`; `sync-notion.ts` renames files atomically when slug changes instead of creating new ones |
| User reorganizes bins after notes accumulate | `source_seed` UNIQUE + `assigned_by` in `note_bins` means auto-assignments re-run safely without clobbering manual choices |
| FTS index drifts from actual vault files | Indexer explicitly DELETE + INSERT on FTS per change; xxhash skip means unchanged files aren't reprocessed; "Reindex all" button in settings for full rebuild |
| Vault path misconfigured | Startup check: `VAULT_PATH` exists and is writable. **Does not require `.obsidian/`** — user may create the vault before first opening it in Obsidian. Settings page surfaces the check result. |
| Notion API version changes | Pin `2026-03-11` in `@notionhq/client` constructor; monitor Notion changelog |
| Mac Mini hardware failure | Vault is redundantly in iCloud across three devices; `data/dashboard.db` is a single file included in daily backups; recovery = restore repo + DB backup + iCloud vault on a new Mac. Estimated downtime: ~1 day. Acceptable for a personal tool. |
| Dashboard auth / exposure | **No application-level auth by design.** Access control is enforced at the network layer by Tailscale — every device on the tailnet is cryptographically authenticated via SSO (Google/Apple/GitHub). External devices cannot reach the dashboard at all. If the threat model expands (sharing with collaborators, untrusted device access), add Cloudflare Access in front — zero Next.js code changes required. |

---

## 13. Testing Strategy

- **Unit tests (Vitest)**: query layer fns, frontmatter parser, markdown→plain-text extractor for FTS, `xxhash` content dedup, bin tree assembly, search query builder, Notion page → markdown converter, slug generator for captures
- **Integration tests**: full indexer pass on a fixture vault (including rename detection); full `sync-notion.ts` run against a mocked Notion API including the rename-by-source-id path; capture flow end-to-end (file → indexer → DB → FTS)
- **Manual test plan** (pre-deploy):
  - Create a Quick Capture → verify file appears in vault, row appears in DB, searchable in < 2s via FTS
  - Add/rename/delete bin → verify UI + DB state; delete confirmation lists children
  - Run Notion sync against real workspace → spot check output markdown; rename a Notion page and re-sync → verify single row with updated `vault_path`, no orphan file
  - Verify FTS search surfaces a known phrase across Notion-mirrored and Obsidian-native notes
  - Kill indexer cron, make file changes on laptop via iCloud, restart cron → verify catch-up on next pass
  - Manually edit `bins: [...]` in a file's frontmatter post-creation → verify indexer ignores the change (§7.3)
- **Not tested**: UI page rendering beyond smoke tests; this is single-user and UI issues are caught in real use

---

## 14. Open Questions

- Slug generation for capture filenames: first 5 words of text → URL-slug, fallback to `<timestamp>-capture` if text is < 3 words. Edge cases (unicode, emoji) need a specific policy — deferred to implementation.
- When user edits a Notion-mirrored file directly in Obsidian, the next Notion sync overwrites their changes. v1 policy: the file is a mirror, period. Surface this explicitly in the note detail UI for Notion-sourced notes: *"This note is mirrored from Notion. Edits here will be overwritten on next sync."* v2 may add bidirectional sync.
- Bin colors / icons: deferred to v1.5 polish pass
- Whether to include `.trash/` files in the soft-delete detection (Obsidian's own trash folder) — probably skip them entirely via glob exclusion

---

## 15. Success Criteria

v1 ships successfully when:

1. Dashboard is running on Mac Mini, accessible via Tailscale, survives reboots
2. Vault at `~/Vault` is populated with at least the user's Notion content + any Obsidian starter files, synced via iCloud across devices
3. Quick Capture works: `Cmd+Shift+C` → type → submit → appears in bin → searchable in under 5 seconds
4. Search finds content across Notion-mirrored and Obsidian-native notes
5. Bins can be created, nested, renamed, merged; notes can live in multiple bins
6. `/review` shows meaningful content (today, uncategorized, stale)
7. Notion sync runs on cron and picks up changes within 15 min; renames handled without orphans
8. Indexer cron runs on 5 min cadence and surfaces Obsidian edits within 5–7 min end-to-end (accounting for iCloud lag)
9. No conflict files accumulating from sync races
10. Cron health indicator on dashboard home is green

---

## Appendix A — Inspiration sources

- Reel 1 (Rui Fu, `DXBCWkwj8vG`): "How to build a second brain with Claude and Obsidian" — validated the Obsidian vault + Claude Code pattern
- Reel 2 (Angus, `DWzHY9lkSZS`): "Companies are ripping out MCP servers for $20 databases" — validated the single-canonical-store-then-agent pattern

Both reinforce: consolidate first, then let the agent operate on the consolidated store. Don't make the agent fan out.

---

## Appendix B — Changelog from v1

Changes applied based on Kimi's audit:

- **FTS5 switched to contentless.** Previous `content=vault_notes` reference was structurally broken (`vault_notes` has no `content` column). Indexer now writes to `vault_notes_fts` directly with matching rowid.
- **Missing indexes added:** `vault_notes(source_id)` partial unique, `vault_notes(modified_at)`, `note_bins(note_id)`, `bins.source_seed` UNIQUE.
- **Notion dedup fixed:** upsert by `source_id` with atomic file rename on slug change. Prevents orphan files + duplicate rows on Notion page rename.
- **`sync_status.cursor`** added for resumable delta sync.
- **Frontmatter invariant (§7.3)** added to resolve the UI-edit / indexer-revert bug.
- **Dependent-files migration list (§3.3)** explicitly enumerates the 8 files that break when `notes` is dropped.
- **Markdown renderer pinned** (`react-markdown@^9` + `remark-gfm@^4`).
- **Dependencies pinned** in new §5.5 with `npm install` command.
- **`.obsidian/` startup requirement dropped** — would have been a catch-22 on first setup.
- **Notion `data_sources` wording clarified** to "query pages by `last_edited_time`."
- **Webhook risk entry removed** — architecturally impossible on Tailscale-only host.
- **Capture hotkey changed** from `Cmd+K` to `Cmd+Shift+C` to avoid browser search collision.
- **Empty-state UI for bin tree** added to §5.1.
- **Auth clarification (§2.2, §12)** — documents that Tailscale's device-level SSO auth IS the access-control layer. No application-level auth needed.

Changes applied based on simplicity audit (my own):

- **Indexer architecture changed from chokidar daemon → cron scan.** Eliminates launchd lifecycle, silent daemon deaths, chokidar/FSEvents/iCloud interaction edge cases. Trade-off: up to 5 min lag for Obsidian edits vs. ~seconds with chokidar. Acceptable given iCloud's own 30s–2min baseline lag and single-user use.
- **Capture flow triggers immediate one-shot indexer** (`vault-indexer.ts --file <path>`) so captures appear instantly without waiting for the next cron tick.
- **launchd plist reduced to just the Next.js app itself** (as already specified in README). No separate daemon to manage.
