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

## Current state (as of last session, 2026-04-27)

**Main branch:** `c156a57` — v1.2/v1.2.1/v1.2.2 shipped + v1.3 spec & plan committed (no v1.3 implementation yet).
**v1.3 implementation branch:** `feature/v1.3-auto-classify` at `92281db` — all 25 tasks done, pushed to origin.
**v1.3 worktree:** `/Users/carterrognes/Work/Claude/Projects/Dashboard-v1.3` (sibling of main repo).
**Tests on v1.3 branch:** 298 passing (was 219 baseline, +79 new). Lint, typecheck, build all clean.
**Manual smoke pending:** v1.3 12-step walkthrough documented in `README.md` `### Manual smoke walkthrough` (on the feature branch). v1.2.1 + v1.2.2 smoke also still pending from prior sessions.
**PR:** Not opened yet. Use `gh pr create` from worktree, or visit https://github.com/Rognes82/Dashboard/pull/new/feature/v1.3-auto-classify

**v1.3 spec/plan reference:**
- Spec: `docs/superpowers/specs/2026-04-26-v13-auto-classify-design.md` (3 Kimi-audit rounds → SHIP)
- Plan: `docs/superpowers/plans/2026-04-26-v13-auto-classify.md` (25 tasks, TDD-structured, 1 Kimi-audit round → SHIP)

**v1.3 final-review flagged follow-ups (non-blocking, candidates for v1.3.1):**
- Add sample crontab line to README's classifier section (currently only mentions `npm run classify`)
- Add warn-log in `scripts/vault-indexer.ts:111` when `frontmatter.bins` references an unresolved bin (currently silent typo footgun — note becomes orphaned with `classifier_skip = 1`)
- Dedupe `titleCase` (defined in both `lib/classify/decide.ts` and `app/api/classify/proposals/[id]/route.ts`)
- `components/settings/ClassifierSettings.tsx` uses spec-literal Tailwind classes (`bg-black/40 border-white/20`); rest of settings page uses `bg-raised border-border-default`. Visual mismatch.
- `/api/classify/run` blocks request thread for the full batch (~2 min for 100-note backlog at 3-concurrency × ~3-4s/call). Toast only renders after completion. Streaming progress is a v1.4 candidate.

**v1.3 highest-risk smoke steps (per final review):**
1. Step 11 — concurrent-run guard (two-process race; verify clean 409 toast vs hang)
2. Step 8 — auto-create titleCase: `q3-okrs` → `"Q3 Okrs"` (cosmetic, not `"Q3 OKRs"`)
3. Step 10 — frontmatter typo footgun (typo'd bin name still flips skip flag)
4. Step 9 — undo of bin shared with another note (bin should NOT delete if other notes assigned)

**What shipped in v1.2:**
- Full UI redesign — chat-primary layout, persistent bin tree sidebar, dark gray +
  off-white + cyan palette, retro-futuristic line icons, JetBrains Mono labels
- `/api/chat` SSE streaming with retrieval (FTS5 + byte budget + bin scope)
- Multi-provider LLM abstraction + AES-256-GCM encrypted profiles
- Reading pane, citation chips, scope badge, suggested prompts, error toasts
- Settings rebuild with profile CRUD + Notion targets + sync health
- Retired pages (`/clients` etc.) still render with a banner, unlinked from nav
- Legacy `/notes` redirects to `/bins`

**What shipped in v1.2.1:**
- Sidebar `+ new bin` button (top-level create)
- Right-click context menu on bins — New child / Rename (inline) / Move bin / Merge into / Delete (hidden for seeded `notion-sync`)
- Right-click context menu on note rows — Open / Add to bin / Move to bin / Remove from this bin (last two visibility-gated by source bin disambiguation)
- Drag-and-drop on bin tree — drag bin onto bin re-parents, drag between siblings reorders (sort_order REAL averaging), drag note onto bin adds (⌘+drag = move when source unambiguous, else add with warn toast)
- Drop indicators (cyan ring on row, cyan strip between rows, red dashed for invalid)
- Reusable primitives — Modal (focus trap, Esc, body scroll lock), ContextMenu (portal-positioned), DragModifierHint pill ("Add" / "Move (⌘)")
- BinPicker modal (Finder-style outline tree with filter), CreateBinModal, DeleteBinModal (blast-radius preview), MergeBinModal (sub-bin re-parent warning)
- Server-side guards — DELETE 403 for seeded bins, PATCH cycle prevention via recursive CTE
- Bug fix in `mergeBin` — re-parents source's children to target before deleting source (cascade was destroying them)
- Cross-tree refresh signal via `dashboard-bins-mutated` CustomEvent so page lists update after sidebar drag mutations

**What shipped in v1.2.2:**
- `GET /api/notes?include=bins` opt-in branch + 2 new query helpers (`listVaultNotesWithBins`, `listVaultNotesByBinWithBins`) using LEFT JOIN + GROUP_CONCAT
- Multi-bin badge `·N` and Recent-view "Move to bin" now actually work — both pages populate `noteBins` map
- `lib/bins/tree.ts` shared utilities (`findBinById`, `collectMatchingIds`); replaces local copies in Sidebar, BinPicker, BinTree
- `components/bin-tree/` directory replaces 430-line `components/BinTree.tsx`: BinTree.tsx (79 lines), BinRow.tsx (286), DropStrip.tsx (50), sort-order.ts (25), index.ts (re-export)
- Sidebar merge state consolidated into `MergeFlow` discriminated union (`idle | picking | confirming`)
- Server-side `sort_order` renumber: when sibling gap collapses below 1e-7, `updateBinSortOrder` renumbers via snapshot-then-iterate (not the broken correlated-UPDATE the plan first proposed — implementer caught it)
- `NoteNotInSourceBinError` typed class replaces string-match in `/api/notes/[id]/move`; unknown errors now return 500 instead of 400
- BinPicker keyboard navigation: ArrowUp/ArrowDown/Enter, scrollIntoView for selected row
- Move toast: `Moved 'X' to 'Y'`. Remove toast: `Removed from 'binName'`.
- Tests: 189 → 219 (+30 across 5 new test files)

**Known v1.2.2 deferrals (out-of-scope per Q5 brainstorm):**
- Picker tree a11y (`role="tree"` / `role="treeitem"` / `aria-expanded`)
- Modal edge cases (zero focusable, single focusable)
- ContextMenu arrow-key navigation
- Client-side cycle detection during dragover (HTML5 limitation)

## User's vision that ISN'T built yet

The user's mental model goes further than anything currently in the spec:

> "I want ideas from a Notion page SPLIT INTO bins appropriate to what they are —
>  like content/japan/reels/ideas gets the Japan reel idea from a 'Content Ideas'
>  doc that has 10 different items. My agent should do the binning for me."

This is **atomic segment extraction** — reading a synced note, identifying
individual ideas within it, and routing each to a deep bin. Not just file-level
auto-classify — idea-level extraction. Outside every spec written so far.

## Roadmap forward

**v1.2.1 — Manual bin management UI** ✅ shipped, merged to main at `023742a`. Spec + plan in `docs/superpowers/{specs,plans}/2026-04-25-manual-bin-management-*.md`.

**v1.2.2 — Cleanup release** ✅ shipped on `feature/v1.2.2-cleanup` branch (pending manual smoke + merge). All 21 plan tasks complete. Spec + plan in `docs/superpowers/{specs,plans}/2026-04-26-v122-cleanup-design.md` and `docs/superpowers/plans/2026-04-26-v122-cleanup.md`.

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

**Immediate priority: smoke v1.3.** Work in the worktree at `/Users/carterrognes/Work/Claude/Projects/Dashboard-v1.3` (branch `feature/v1.3-auto-classify`). The 12-step manual smoke walkthrough is in that branch's `README.md` under `### Manual smoke walkthrough`.

**Smoke setup (one-time, in worktree):**
```bash
cd /Users/carterrognes/Work/Claude/Projects/Dashboard-v1.3
# Snapshot main DB (WAL-aware) so worktree has bins/profiles/settings:
sqlite3 /Users/carterrognes/Work/Claude/Projects/Dashboard/data/dashboard.db ".backup data/dashboard.db"
cp /Users/carterrognes/Work/Claude/Projects/Dashboard/.env.local .env.local
VAULT_PATH=$HOME/Vault PORT=3001 npm run dev   # starts on :3001
# In another shell, confirm migration applied:
sqlite3 data/dashboard.db "PRAGMA user_version;"  # should print 1
```

After dev server is up, open http://localhost:3001/settings → confirm "Classifier" section appears. Then http://localhost:3001/review → "Run classifier now" button + the 12-step walkthrough.

**After smoke passes:**
1. Patch any smoke findings on the branch
2. Address final-review follow-ups in the "v1.3 final-review flagged follow-ups" list above (cron sample, frontmatter warn-log, dedupe titleCase, settings palette)
3. `gh pr create` from worktree (or use https://github.com/Rognes82/Dashboard/pull/new/feature/v1.3-auto-classify)
4. Merge to main, delete worktree (`git worktree remove ../Dashboard-v1.3`)
5. Update this CLAUDE.md "Current state" section to reflect v1.3 shipped on main

**After v1.3 merges, next decision:**
- **v1.4 segment extraction** — needs new brainstorm cycle. User's vision: split a Notion doc's 10 atomic ideas into 10 routed bins. v1.3 was prerequisite infrastructure.
- **Phase 4 deploy** — Mac Mini launchd plist + cron entries (vault-indexer + sync + classifier), backups, iCloud verification. Cron entry for classifier needs to be added to README before deploy.
- **v1.3.1 polish** — the final-review follow-ups consolidated into one cleanup release.

Pattern to follow: brainstorm → spec → Kimi audit → plan → Kimi audit → execute (subagent-driven, Opus on Max 20x).

**When picking up, verify in the worktree:**
- `git branch --show-current` — `feature/v1.3-auto-classify`
- `git log --oneline | head -3` — top should be `92281db docs(v1.3): classifier README section`
- `npm test` — 298 passing
- `npm run lint` / `npx tsc --noEmit` / `npm run build` — clean (build has ~10 pre-existing prerender errors on API routes due to no DB at static-export time; tolerated, not a regression)
