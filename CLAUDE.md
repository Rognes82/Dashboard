# Dashboard — Project Context for Claude

This file is the onboarding doc for any Claude session working on this project.
Read it first; it captures durable context that isn't obvious from `git log`.

## What this is

A **chat-primary knowledge dashboard** for a solo creative/dev agency (Vakari Creative).
Architecture: Next.js 14 + SQLite (metadata only) on a Mac Mini behind Tailscale.
The **Obsidian vault at `~/Vault/` is the canonical store** — notes live as markdown
files; the dashboard is a viewport + organizing layer + retrieval agent on top.

Content sources that sync INTO the vault:
- Obsidian native markdown (user writes directly)
- Notion pages (via `sync-notion.ts`, page-based — user does NOT use Notion databases)
- Quick Captures (`Cmd+Shift+C` modal → writes to `~/Vault/captures/`)
- Apple Notes (deferred to v2)

Agent: multi-provider LLM (Anthropic native + OpenAI-compatible) with encrypted
profile storage. User has Anthropic direct configured. Can add OpenRouter / Kimi /
local via settings.

## Current state (as of last session)

**Branch:** `feature/thought-organizer-v12` — v1.2 agent-first redesign.
**Tests:** 160 passing, lint clean, build clean.
**Merged to main?** No. Phase 1 (v1.0) and Phase 2 (v1.1) are on main.
**Deployed to Mac Mini?** Never. Still local-only on the MacBook.

**What shipped in v1.2:**
- Full UI redesign — chat-primary layout, persistent bin tree sidebar, dark gray +
  off-white + cyan palette, retro-futuristic line icons, JetBrains Mono labels
- `/api/chat` SSE streaming with retrieval (FTS5 + byte budget + bin scope)
- Multi-provider LLM abstraction + AES-256-GCM encrypted profiles
- Reading pane, citation chips, scope badge, suggested prompts, error toasts
- Settings rebuild with profile CRUD + Notion targets + sync health
- Retired pages (`/clients` etc.) still render with a banner, unlinked from nav
- Legacy `/notes` redirects to `/bins`

## User's vision that ISN'T built yet

The user's mental model goes further than anything currently in the spec:

> "I want ideas from a Notion page SPLIT INTO bins appropriate to what they are —
>  like content/japan/reels/ideas gets the Japan reel idea from a 'Content Ideas'
>  doc that has 10 different items. My agent should do the binning for me."

This is **atomic segment extraction** — reading a synced note, identifying
individual ideas within it, and routing each to a deep bin. Not just file-level
auto-classify — idea-level extraction. Outside every spec written so far.

## Roadmap forward

**v1.2.1 — Manual bin management UI** (shortest path, ~1 week)
Gap we missed in v1.2. Add:
- "+ new bin" button in sidebar with parent picker (nesting)
- Right-click note → move to bin
- Right-click bin → rename / merge / delete
- APIs exist (`POST /api/bins`, `POST /api/bins/[id]/assign`, etc.) — just no UI yet
This gives the user agency over their structure BEFORE any agent does binning.
You can't sanely build a classifier on an empty bin set.

**v1.3 — Whole-note auto-classify** (scoped in original spec §9, ~2 weeks)
- `scripts/agent-classify.ts` reads uncategorized notes, asks LLM to pick a bin
  from the existing hierarchy, assigns via `assignNoteToBin`
- Runs after sync + on cron
- User reviews/overrides in `/review` Uncategorized card

**v1.4 — Atomic segment extraction** (the user's full vision, needs its own brainstorm)
- Design tension: fragment vs mirror. Canonical vault files stay intact; agent creates
  new capture-style notes that LINK back to source. `extracted_from:` frontmatter.
- Requires segmentation logic + classification per segment + cross-references
- Full spec + plan cycle required

**Phase 4 — Deploy to Mac Mini** (never planned yet)
- Launchd plist, cron entries for vault-indexer + sync-notion + sync-obsidian
- Daily backups, iCloud vault verification
- README's deploy runbook is the starting point

## Collaboration patterns this user likes

**Kimi two-step audit.** For every major spec and plan, offer an audit prompt
for the user to paste into Kimi (their other AI). Kimi caught real bugs in
Phase 1, 2, and 3 — FTS5 triggers, p-limit ESM trap, Notion SDK method rename,
machine-key recovery UX, and more. Pattern:

1. Write spec → offer Kimi audit prompt → user pastes Kimi's response
2. Patch spec → offer Kimi re-audit prompt → user pastes
3. Green-light → write plan → offer Kimi audit prompt → user pastes
4. Patch plan → re-audit → green-light → execute

Kimi's strength is empirical codebase checks (actually running commands, checking
SDK method signatures, verifying schema columns exist) + execution sequencing.
Claude's strength is architectural reasoning, visual design, and integration.
They complement well — use both.

**Subagent-driven development** (from superpowers plugin). Dispatch a fresh
general-purpose agent per task with the task's full text + scene-setting
context. User has Max 20x plan — **always use Opus for agents** (saved in memory).
Implementer catches plan bugs in about 1 in 5 tasks; review loop catches more.

**Honesty over defense.** When the user says "feels bare bones" or "we strayed from
the spec," don't defend — acknowledge the gap, map it to the spec, propose
concrete paths forward, and recommend one.

**Explicit pushback on assumptions.** User has corrected me when I:
- Assumed they used Obsidian (they didn't at the time; had to design the Obsidian-adoption decision deliberately)
- Assumed Notion databases (they use plain pages — we pivoted sync architecture mid-Phase-2)
- Skipped a question instead of asking (leads to wasted work)

## Dev workflow

- **Port 3001** for dev server. Port 3000 is always taken by the user's bun process
  (a different project on the same Mac). Always start with `PORT=3001`.
- **Vault path:** `VAULT_PATH=$HOME/Vault npm run dev` — env var required for
  sync scripts and chat retrieval.
- **Notion token:** `.env.local` has `NOTION_TOKEN=ntn_...` (gitignored).
  Value may have been rotated — if sync fails with 401, user rotated; grab new
  token from https://www.notion.so/profile/integrations.
- **Model for chat:** currently `claude-sonnet-4-6` via Anthropic direct profile.
  User may switch to Opus or Kimi via OpenRouter. Profile is encrypted in SQLite.
- **LLM profile key location:** `~/.config/dashboard/machine-key` (mode 0600).
  If deleted, all profile keys must be re-entered. Modal not yet implemented for
  recovery — returns 500 on chat API for now.

## Key architectural decisions (don't redo)

1. **Vault-as-backbone, SQLite-as-metadata-only.** Zero note content in SQLite.
   Reads happen from vault files on demand. Breaking this invariant (e.g., to
   do atomic segment extraction by fragmenting source files) needs deliberate
   brainstorming — discussed in v1.4 roadmap above.

2. **Tailscale is the auth layer.** No app-level auth. User's devices are on their
   tailnet; external devices can't reach the dashboard at all. Adding auth would
   not improve security. Documented in spec §12.

3. **Page-based Notion sync, not database-based.** Pivoted mid-Phase-2 when user
   said they don't use Notion databases. `sync-notion.ts` iterates page IDs from
   `app_settings.notion.sync_targets` and outputs flat `~/Vault/notion-sync/<slug>.md`.

4. **No chokidar daemon.** Cron-driven vault indexer every 5 min. Capture triggers
   an immediate one-shot index pass. Avoided launchd lifecycle + FSEvents edge
   cases. Trade-off: up to 5 min lag for Obsidian edits to propagate.

5. **iCloud for vault sync across devices.** Not Obsidian Sync. User already pays
   for 200GB iCloud (solves phone storage + vault in one subscription). If sync
   lag becomes annoying, upgrade to Obsidian Sync ($4/mo) — trivial migration.

6. **No emojis in UI.** User was specific: "white retro-futuristic" line icons.
   Emoji icons were replaced with custom SVG components in `components/icons.tsx`.

7. **Minimal nav.** Only 4 top-level surfaces: Chat, Bins, Review, Settings.
   Clients/Projects/Agents/Files exist as data but are not in primary nav.
   Retired pages show a banner; URLs still work for deep-links.

## Key files to know

- `docs/superpowers/specs/2026-04-24-agent-first-redesign-design.md` — v1.2 spec
- `docs/superpowers/plans/2026-04-24-agent-first-redesign.md` — v1.2 plan (4,238 lines)
- `lib/llm/` — provider abstraction, encryption, retrieval, prompt
- `lib/queries/` — SQLite CRUD for vault_notes, bins, app-settings, sync-status
- `lib/vault/` — frontmatter parser, markdown→plain-text, xxhash
- `scripts/vault-indexer.ts` — cron-driven scanner
- `scripts/sync-notion.ts` — page-based Notion sync
- `components/chat/` — all chat-related components
- `.superpowers/brainstorm/78327-1777032305/content/` — visual companion mockups
  from the redesign brainstorm (gitignored, may be stale, useful reference)

## What to do next session

User's immediate next goal: **continue down the roadmap**. Start v1.2.1 (manual
bin UI) or jump to v1.3 (auto-classify agent). User's preference expressed last
session: manual UI first, then classifier, then segment extraction.

Pattern to follow: brainstorm → spec → Kimi audit → plan → Kimi audit → execute
(subagent-driven, Opus). Commit on a new feature branch off main or off v12.

When picking up, verify:
- `git branch --show-current` — should be on `feature/thought-organizer-v12` (v1.2 is there, not merged)
- `npm test` — should show 160 passing
- Dev server — if cold, start with `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`
- Dashboard at http://localhost:3001 — chat should stream with an active profile
