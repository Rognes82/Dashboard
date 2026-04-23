# Thought Organizer — v1 Design Spec

**Date:** 2026-04-23
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

- Next.js app on the Mac Mini, accessed via Tailscale (no auth, LAN-only)
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

The existing `notes` table is dropped (no production data). New tables:

```sql
-- Replace the existing notes table — content now lives in vault files
DROP TABLE notes;

CREATE TABLE vault_notes (
    id TEXT PRIMARY KEY,              -- ulid
    vault_path TEXT UNIQUE NOT NULL,  -- relative path from ~/Vault
    title TEXT NOT NULL,              -- from frontmatter > first heading > filename
    source TEXT NOT NULL,             -- 'obsidian' | 'notion' | 'capture' | 'apple-notes'
    source_id TEXT,                   -- Notion page id, etc.
    source_url TEXT,
    content_hash TEXT NOT NULL,       -- xxhash of file contents for change detection
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,        -- filesystem mtime
    last_indexed_at TEXT NOT NULL,
    client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

-- FTS5 virtual table for cross-source search
CREATE VIRTUAL TABLE vault_notes_fts USING fts5(
    title, content, tags,
    content=vault_notes, content_rowid=rowid
);

-- Bins — hierarchical organizing primitive
CREATE TABLE bins (
    id TEXT PRIMARY KEY,              -- ulid
    name TEXT NOT NULL,
    parent_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
    source_seed TEXT,                 -- e.g. 'obsidian:Content/Reels' if auto-created
    created_at TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Junction — a note can live in multiple bins
CREATE TABLE note_bins (
    note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
    bin_id TEXT NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL,
    assigned_by TEXT NOT NULL,        -- 'auto' | 'manual' | 'agent'
    PRIMARY KEY (note_id, bin_id)
);

-- Tags extracted from frontmatter and inline #hashtags
CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

CREATE INDEX idx_vault_notes_source ON vault_notes(source);
CREATE INDEX idx_vault_notes_client ON vault_notes(client_id);
CREATE INDEX idx_vault_notes_project ON vault_notes(project_id);
CREATE INDEX idx_bins_parent ON bins(parent_bin_id);
CREATE INDEX idx_note_bins_bin ON note_bins(bin_id);
CREATE INDEX idx_note_tags_tag ON note_tags(tag);
```

**Key decisions:**
- `vault_notes` is an index over the vault. Content lives in files.
- Bins are a tree (`parent_bin_id`); notes live in multiple bins (`note_bins`).
- `source_seed` lets us reconstruct auto-creation lineage for safe re-running.
- `assigned_by` distinguishes auto vs manual vs agent so re-runs don't clobber user choices.

### 3.3 What's intentionally NOT in SQLite

- Note content (lives in vault files, read on demand)
- Full vault tree (index only what we surface)
- Wikilinks / backlinks (deferred to v2 — lazy-parsed from vault when needed)

---

## 4. Sync Pipeline

Three scripts, each with one responsibility. All follow the existing `upsertX + recordSyncRun + closeDb` pattern.

### 4.1 `scripts/vault-indexer.ts` — long-running daemon

- Watches `~/Vault/**/*.md` with chokidar
- On add/change:
  - Parses frontmatter (gray-matter)
  - Computes xxhash of content; skips if hash matches `content_hash` in DB
  - Upserts `vault_notes` row
  - Refreshes FTS5 index
  - Extracts tags from frontmatter + inline hashtags
  - If frontmatter contains `bins: [...]`, upserts `note_bins` rows with `assigned_by: auto`
- On delete: soft-delete (mark) for one sync cycle, then hard-delete if still missing
- Runs under launchd as a separate process (not inside Next.js — HMR kills watchers)
- Conflict-safe: stat-then-read; if mtime changes between stat and read, retry

### 4.2 `scripts/sync-notion.ts` — cron-driven poller (every 15 min)

- Uses `@notionhq/client` + internal integration token
- Delta sync: for each configured data source, query by `last_edited_time > last_sync_ts` (stored in `sync_status`)
- For each changed page:
  - Fetch block tree recursively
  - Convert to markdown (walk blocks → paragraph / heading / list / code / quote / toggle → markdown)
  - Write via atomic rename to `~/Vault/notion-sync/<db-name>/<slugified-title>.md`
  - Frontmatter: `source: notion`, `source_id: <page-id>`, `source_url: <notion-url>`, `last_synced_at: <iso>`
- Rate limiting: token bucket at 2.5 req/s with jitter; exponential backoff on 429s (1s → 2s → 4s → 8s, max 60s)
- Respects `sync_status` cursor to resume after failure
- Vault indexer picks up the new/changed files automatically

### 4.3 `scripts/sync-obsidian.ts` — one-time seed (re-runnable)

- Scans the full vault, upserts `vault_notes` rows for any file not yet indexed
- **Bin auto-seeding** (runs only on first execution, or when explicitly triggered):
  - For each top-level folder in `~/Vault/notes/`, create a bin with `source_seed: obsidian:<folder-name>`, `assigned_by: auto`
  - For each Notion database in `~/Vault/notion-sync/`, create a bin with `source_seed: notion:<db-name>`, `assigned_by: auto`
  - Assign existing notes to bins based on their folder location
- Re-running is safe: skips bins that already exist by `source_seed`; skips notes already assigned via `assigned_by: auto` unless user forces reseed

### 4.4 Authentication

- Notion: user creates an internal integration in Notion workspace settings, shares the target databases/pages with it, drops the `secret_xxx` token in `.env.local` (v1) or via Settings page (v1.1).
- No OAuth needed — single user, single workspace.

---

## 5. UI Surfaces

### 5.1 Modified pages

- **`/notes`** — becomes the bin browser + search
  - Left sidebar: tree of bins (nested), with note counts
  - Main area: list of notes in the selected bin, faceted filters above (source, tag, client, date range)
  - Top bar: global FTS5 search input
  - "No bin selected" default view: recent notes across all bins

- **Sidebar (global)** — gains a "Capture" button with keyboard shortcut (`Cmd+K` default) that opens the Quick Capture modal from anywhere in the dashboard.

### 5.2 New pages

- **`/notes/[id]`** — note detail
  - Parsed markdown (read-only in v1; editing happens in Obsidian)
  - Frontmatter panel (metadata)
  - "In bins:" chips with remove button
  - "Add to bin" autocomplete
  - Source link: click-through to Notion URL, or "Open in Obsidian" (via `obsidian://` URL scheme)
  - v2: "Linked from" (backlinks) panel

- **`/review`** — daily/weekly review surface
  - **Today** — notes modified today, today's daily note if it exists
  - **Uncategorized** — notes with no bin assignment
  - **Stale bins** — bins with no new notes in 30+ days

### 5.3 New components

- `BinTree` — recursive nested list with expand/collapse, click-to-select. v1.5 adds drag-reorder.
- `NoteList` — source icon, title, tags, bin chips, modified date
- `QuickCapture` — modal: textarea + bin picker (autocomplete over existing bins, can create new inline) + optional tag input. Submit writes markdown file to vault.
- `SearchBar` — FTS5-backed, keyboard-first, result preview with highlighted matches

### 5.4 Settings page additions

- `VAULT_PATH` — default `~/Vault`, editable
- `NOTION_TOKEN` — paste integration secret
- `NOTION_SYNC_TARGETS` — list of Notion database IDs to sync; user picks
- `CAPTURE_FOLDER` — default `captures/`
- "Run initial vault scan" button — triggers `sync-obsidian.ts` + bin auto-seeding

---

## 6. Capture Flow

1. User hits `Cmd+K` anywhere in dashboard → `QuickCapture` modal opens
2. User types thought, picks a bin (autocomplete, can create new bin inline), optionally adds tags
3. On submit:
   - Dashboard generates a file at `~/Vault/captures/2026-04-23-14-32-<slug>.md`
   - Frontmatter includes `source: capture`, `created_at: <iso>`, `bins: [<bin-id>]`, `tags: [...]`
   - Body is the user's text
   - Written via atomic rename (tmp file + rename)
4. `POST /api/notes/capture` returns 200 after file exists
5. Vault indexer sees the new file (chokidar event), parses frontmatter, upserts `vault_notes` row + `note_bins` row
6. User sees toast: "Captured to <bin-name>"

**Invariant:** captures are markdown files first, DB records second. If the dashboard or indexer is down, the file exists and catches up on next start. If iCloud is slow, other devices get the file later. No fragile paths.

---

## 7. Search + Bins Behavior

### 7.1 Search

- FTS5 virtual table (`vault_notes_fts`) indexes title, content, tags
- Content is pulled from vault file on index time (indexer reads file → extracts plain text → writes to FTS)
- Search API: `GET /api/notes/search?q=<query>&bin=<bin-id>&source=<source>&tag=<tag>`
- Results include snippet with highlighted matches (FTS5 `snippet()` function)

### 7.2 Bin operations

- `POST /api/bins` — create bin with optional `parent_bin_id`
- `PATCH /api/bins/[id]` — rename, reparent, reorder
- `DELETE /api/bins/[id]` — with confirmation; cascades note_bins
- `POST /api/bins/[id]/assign` — add note to bin (upsert note_bins with `assigned_by: manual`)
- `DELETE /api/bins/[id]/assign/[note-id]` — remove note from bin

### 7.3 Bin merging

- User can merge bins from different sources (e.g., Notion "Reels" DB bin + Obsidian "Content/Reels/" folder bin into one bin)
- Merge operation: move all `note_bins` rows from source bin to target bin, delete source bin
- Safe because notes are referenced by file path, not folder — merging bins doesn't move files

---

## 8. Review Surface

`/review` computes and displays:

- **Today** — `SELECT * FROM vault_notes WHERE modified_at >= start_of_day ORDER BY modified_at DESC`
- **Uncategorized** — `SELECT * FROM vault_notes WHERE id NOT IN (SELECT note_id FROM note_bins) ORDER BY modified_at DESC`
- **Stale bins** — `SELECT bins.*, MAX(vault_notes.modified_at) as last_activity FROM bins LEFT JOIN note_bins ON ... LEFT JOIN vault_notes ON ... GROUP BY bins.id HAVING last_activity < date('now', '-30 days') OR last_activity IS NULL`

---

## 9. Agent Integration Points (v3 prep)

v1 designs for v3 without building it:

- **Vault path is discoverable** — `VAULT_PATH` env var; agent can find files
- **Frontmatter is canonical** — agent can read bin assignments + source metadata without querying the DB
- **Write path is safe** — agent writes files the same way the dashboard does (atomic rename, frontmatter)
- **Dashboard API exposes structured data** — `GET /api/clients/[id]`, `GET /api/projects/[id]` give agent context for routing decisions

v3 will add:
- `scripts/agent-classify.ts` — on new captures without bins, ask Claude to suggest bins; present suggestions in review surface
- `scripts/agent-health-check.ts` — weekly cron; ask Claude to find contradictions, stale info, uncategorized-too-long notes; write report to `~/Vault/wiki/health-check-<date>.md`
- `/chat` page — Tailscale-accessible chat that queries the vault via Claude API

---

## 10. Rollout Plan

### Phase 1 — Foundation (v1.0)

1. Schema migration: drop `notes`, add `vault_notes`, `bins`, `note_bins`, `note_tags`, FTS5 virtual table, indexes
2. Query layer: `vault_notes` CRUD, `bins` CRUD, `note_bins` ops, FTS search wrapper (+ tests)
3. `scripts/vault-indexer.ts` — chokidar watcher + parse + upsert; run manually first
4. `scripts/sync-obsidian.ts` — seed scan + bin auto-creation
5. API routes: `GET/POST /api/notes`, `GET /api/notes/[id]`, `GET/POST /api/bins`, `PATCH/DELETE /api/bins/[id]`, `POST /api/bins/[id]/assign`, `GET /api/notes/search`
6. `/notes` page rebuild: bin tree + note list + search bar
7. `/notes/[id]` detail page

### Phase 2 — Capture + Notion sync (v1.1)

8. Quick Capture modal + hotkey + `POST /api/notes/capture`
9. `scripts/sync-notion.ts` — initial pull + delta poll
10. Settings page additions (vault path, Notion token, sync targets)
11. `/review` page

### Phase 3 — Deploy (v1.2)

12. Launchd plist for vault indexer (daemonize)
13. Cron entries for `sync-notion.ts`
14. Vault backup cron
15. Deploy to Mac Mini, verify Tailscale access end-to-end

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

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| iCloud sync races with Mini background writes → conflict files | Atomic-rename writes everywhere; sync scripts skip files modified in last 30s; schedule heavy writes at 3 AM |
| Vault indexer dies silently under launchd | Health check on dashboard home page: `sync_status.vault_indexer.last_run`; red dot if > 10 min old |
| Notion rate limits during large initial backfill | Token bucket at 2.5 req/s, exponential backoff on 429, resumable via `sync_status` cursor |
| User reorganizes bins after notes accumulate → messy state | `source_seed` on bins + `assigned_by` on note_bins lets auto-assignments re-run safely without clobbering manual choices |
| FTS index drifts from actual vault files | `last_indexed_at` + `content_hash` check on each pass; "Reindex all" button in settings |
| Vault path misconfigured → sync writes to wrong place | Startup check: `VAULT_PATH` exists, is writable, contains `.obsidian/`; fail fast if not |
| Notion API version changes (post-2025-09-03 migration) | Build against `2026-03-11`; pin API version in `@notionhq/client` constructor |
| Sync scripts collide on the same file | Each script writes to its own subfolder (`captures/`, `notion-sync/`) — no overlap |

---

## 13. Testing Strategy

- **Unit tests (Vitest)**: query layer fns, frontmatter parser, markdown→blocks converter, bin tree assembly, search query builder
- **Integration tests**: full indexer pass on a fixture vault; full `sync-notion.ts` run against a mocked Notion API; capture flow end-to-end (file → indexer → DB)
- **Manual test plan** (pre-deploy):
  - Create a Quick Capture → verify file appears in vault, row appears in DB, shows in bin
  - Add/rename/delete bin → verify UI + DB state
  - Run Notion sync against real workspace → spot check output markdown files
  - Verify FTS search surfaces a known phrase across sources
  - Kill indexer, make file changes, restart indexer → verify catch-up
- **Not tested**: UI page rendering beyond smoke; this is single-user and UI issues are caught in real use

---

## 14. Open Questions

- Keyboard shortcut for capture: `Cmd+K` is common but may conflict with browser search. Alternative: `Cmd+Shift+C`. Pick during implementation.
- Slug generation for capture filenames: current plan is `<timestamp>-<first-5-words-of-text>`. If text is short or empty, fall back to `<timestamp>-capture`.
- When user edits a Notion-mirrored file directly in Obsidian, our mirror gets out of sync with Notion. v1 policy: indexer respects the edit (updates DB), but next Notion sync overwrites the file. Document this explicitly in UI. v2 may add conflict handling.
- Should bins have colors / icons for visual scanning? Nice-to-have, deferring.

---

## 15. Success Criteria

v1 ships successfully when:

1. Dashboard is running on Mac Mini, accessible via Tailscale, survives reboots (launchd)
2. Vault at `~/Vault` is populated with at least the user's current Notion content + any Obsidian starter files
3. Quick Capture works: `Cmd+K` → type → submit → appears in bin → searchable in under 5 seconds
4. Search finds content across Notion-mirrored and Obsidian-native notes
5. Bins can be created, nested, renamed, merged, and notes can live in multiple bins
6. `/review` shows meaningful content (today, uncategorized, stale)
7. Notion sync runs on cron and picks up changes within 15 min
8. No conflict files accumulating from sync races

---

## Appendix A — Inspiration sources

- Reel 1 (Rui Fu, `DXBCWkwj8vG`): "How to build a second brain with Claude and Obsidian" — validated the Obsidian vault + Claude Code pattern
- Reel 2 (Angus, `DWzHY9lkSZS`): "Companies are ripping out MCP servers for $20 databases" — validated the single-canonical-store-then-agent pattern

Both reinforce: consolidate first, then let the agent operate on the consolidated store. Don't make the agent fan out.
