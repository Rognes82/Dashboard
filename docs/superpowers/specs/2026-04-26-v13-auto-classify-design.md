# v1.3 — Whole-note Auto-Classify (Spec)

**Status:** Design complete; awaiting user review before plan-writing.
**Branch target:** `feature/v1.3-auto-classify` (created from `main` at plan time).
**Predecessor:** v1.2.2 cleanup, merged at `8027b02`.
**Successor (out of scope here):** v1.4 atomic segment extraction.

---

## 1. Purpose

Place uncategorized notes — fresh Quick Captures, freshly synced Notion pages, manually created Obsidian notes — into the right bin in the user's existing taxonomy. Auto-assign when the agent is confident; queue a proposal for review when it isn't. Drains the seeded `notion-sync` holding pen as a side effect, fulfilling the user's stated vision of "ideas from a Notion page split into bins appropriate to what they are."

This is the precursor to v1.4's atomic segment extraction. v1.3 establishes the classifier infrastructure — prompt design, profile selection, threshold logic, schema, review UX — operating on the simplest unit (whole notes). v1.4 will substitute extracted segments for whole-note input without changing the classifier surface.

---

## 2. Scope

### In scope

- `scripts/agent-classify.ts` — standalone classifier process; runs on cron + manual trigger
- Per-note classification (whole-note → single bin), parallel concurrency 5, prompt-cached bin tree
- New-bin proposals gated by `rating ≥ 0.75` AND `margin ≥ 0.3` over best existing match
- Hard constraint: auto-bin-creation requires the proposed bin's parent to already exist
- `/review` surface: Pending Proposals card + Recently Auto-Classified card (7-day window)
- Settings: classification model picker (falls back to active chat profile if unset)
- Frontmatter `bin:` override: indexer pre-assigns and skips classifier
- 3-strikes auto-skip and manual "Stop trying" via `classifier_skip` flag
- Per-run cap of 100 notes; per-run audit row in `classifier_runs`
- Append-only `classification_log` for full audit trail

### Out of scope (v1.4 territory or later)

- Atomic segment extraction (splitting a single source note into many bin-routed segments)
- Multi-bin classifier output (classifier returns at most one assignment per note in v1.3)
- Re-classification of already-binned notes when taxonomy changes
- Bulk accept/reject in `/review`
- Active learning / fine-tuning on user corrections
- Calibration histogram visualization in settings
- Per-bin acceptance-rate stats
- Cross-note deduplication / contradiction detection (separate weekly health-check agent in v1.2 spec, not this work)
- Right-click "Re-classify this note" on note rows

### Why this scope

v1.3 establishes the classifier infrastructure (prompt, profile, schema, review UX, threshold tuning surface) using the simplest unit of input. v1.4's atomic-segment work then layers on top — same prompt shape, same threshold gates, same review surface — but operating on extracted segments instead of whole notes. Building v1.3 first gives real calibration data (top-1 accuracy, calibration curve, bin-creation rate) before tackling the harder segmentation problem.

---

## 3. Decision Log

All choices reached in brainstorm before this spec was written.

| Q | Decision | Rationale |
|---|----------|-----------|
| Q1 | Hybrid by confidence; threshold 0.6 — auto-assign when `existing.confidence ≥ 0.6`, queue otherwise | "Mostly works on its own" intent; wrong existing-bin assignment is small mistake, easily reversed |
| Q2 | Allow propose-new-bin as a third classifier outcome | Vision involves importing lots of new content where existing bins won't always fit; bin creation must be available |
| Q3 | Auto-create gate: `rating ≥ 0.75` AND `(rating − existing.confidence) ≥ 0.3` AND parent exists | "Not bin happy" requirement; absolute floor + comparative margin prevents most bloat |
| Q4 | Separate cron + manual trigger button in `/review` | Decouples LLM-touching component from indexer reliability; manual trigger removes friction during big sync sessions |
| Q5 | Single-bin classification only in v1.3 | Multi-bin proper is segment-extraction territory (v1.4); single-bin yields cleaner calibration data; manual second-bin add via right-click already exists |
| Q6 | Minimal prompt input — note + flat bin paths only | Bin paths in this dashboard are deeply nested and meaningful, carry strong signal; few-shot scales poorly past 50 bins; descriptions can be added later if disambiguation is needed |
| Q7 | Settings dropdown picks classify profile; falls back to active chat profile if unset | Reuses existing multi-profile system; low-friction default; user can target Haiku 4.5, Kimi K2, or local models per-task |
| Q8 | Two cards in `/review`: Pending Proposals + Recently Auto-Classified (7-day window, quick-undo) | Pending is the active queue; recent-auto is the audit trail that makes auto-assignment safe |
| Q9 | Drain `notion-sync` AND uncategorized notes; one-shot at intake, never re-classifies once assigned | Matches "Notion ideas → deep bins" vision; reframes `notion-sync` correctly as a transient holding pen |
| Q10 | Parallel `p-limit(5)` per-note calls, prompt-cached bin tree | Best of both: per-note error isolation + cheap shared prefix via cache; concurrency safe at Anthropic tier-1 rate limits |
| Q11 | Frontmatter `bin:` overrides classifier; rejection re-queues with `classifier_attempts++`; 3-strikes → auto-skip; manual "Stop trying" button anytime | Frontmatter is small powerful escape hatch; re-queue lets classifier improve as taxonomy evolves; counter prevents loops |

---

## 4. Architecture

### Top-level flow

```
trigger (cron / manual)
   │
   ▼
scripts/agent-classify.ts
   │
   ├─ INSERT classifier_runs (zero-row guard if another run is in flight → abort)
   ├─ query: SELECT notes WHERE
   │     (note has no bin assignments     -- truly uncategorized
   │      OR note's ONLY bin is notion-sync)  -- in source pool, no real bin yet
   │     AND classifier_skip = 0
   │     AND id NOT IN (SELECT note_id FROM classification_proposals)
   │     LIMIT 100
   │   (notes already in any non-notion-sync bin are NOT processed; that's
   │    a real assignment and v1.3 does not re-classify)
   ├─ pLimit(5) per-note pipeline:
   │     ├─ build prompt (system + cached bin tree + note content)
   │     ├─ call LLM via classify profile
   │     ├─ parse + validate output (zod)
   │     ├─ decide: apply Q1 threshold and Q3 gates
   │     └─ commit:
   │           ├─ auto_assign       → note_bins INSERT (remove notion-sync if present)
   │           ├─ auto_create_bin   → bins INSERT + note_bins INSERT
   │           └─ pending           → classification_proposals INSERT
   │     └─ classification_log row written for every outcome
   ├─ UPDATE classifier_runs (finished_at, counts)
   └─ return summary
```

### Module layout

| File | Purpose | Pure |
|------|---------|------|
| `lib/classify/prompt.ts` | Build system prompt + bin tree + per-note content | ✓ |
| `lib/classify/parse.ts` | Validate / parse LLM output via zod | ✓ |
| `lib/classify/decide.ts` | Apply threshold + margin → action | ✓ |
| `lib/classify/profile.ts` | Resolve classify profile (settings → active chat profile) | ✓ |
| `lib/classify/run.ts` | Per-note flow (prompt → LLM → parse → decide → commit) | impure |
| `lib/queries/classifications.ts` | DB ops (list/accept/reject/undo proposals; recent-auto query) | impure |
| `scripts/agent-classify.ts` | Entry point: query batch, p-limit, log run | impure |

### API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/classify/run` | POST | Manual trigger |
| `/api/classify/proposals/[id]` | PATCH | Accept / reject / edit-path |
| `/api/classify/auto/[id]/undo` | POST | Reverse a recent auto-classification |
| `/api/notes/[id]/classifier-skip` | PATCH | Toggle skip flag |

### Indexer hook (frontmatter override)

`scripts/vault-indexer.ts` adds: when parsing a note's frontmatter, if `bin:` is present and resolves to an existing bin path, immediately assign that bin AND set `classifier_skip = 1`. The classifier never sees those notes. Existing 5-min cron cadence preserved; no new daemon.

### Cron — dev vs prod

- **Dev:** `npm run classify` (added to package.json) — manual invocation; not auto-scheduled
- **Prod (Phase 4 deploy):** launchd plist running `bun scripts/agent-classify.ts` at the configured interval (default 10 min), separate plist from the existing 5-min vault-indexer plist

### Concurrency / failure (summary; full detail in §8)

- p-limit(5) on per-note LLM calls
- Per-note retry on malformed JSON (1×) with explicit follow-up message
- Per-note exponential backoff on 429 (max 3 attempts: 250ms / 1s / 4s)
- Catastrophic failures abort the run cleanly with user-readable error
- Concurrent-run guard: zero-row INSERT pattern on `classifier_runs`

---

## 5. Data Model

### Column additions on `vault_notes`

```sql
ALTER TABLE vault_notes ADD COLUMN classifier_skip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vault_notes ADD COLUMN classifier_attempts INTEGER NOT NULL DEFAULT 0;
```

### New tables

```sql
-- Pending decisions waiting on user review.
-- Row deleted on accept/reject (audit row written to classification_log).
CREATE TABLE IF NOT EXISTS classification_proposals (
  id TEXT PRIMARY KEY,                                  -- ULID
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

-- Append-only audit log.
-- Drives the Recently Auto-Classified card and future calibration analysis.
CREATE TABLE IF NOT EXISTS classification_log (
  id TEXT PRIMARY KEY,
  note_id TEXT REFERENCES vault_notes(id) ON DELETE SET NULL,
  action TEXT NOT NULL,            -- auto_assign | auto_create_bin | pending
                                   -- | accepted | rejected | undone | error
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

-- Per-run metadata.
CREATE TABLE IF NOT EXISTS classifier_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,           -- cron | manual
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  notes_seen INTEGER NOT NULL DEFAULT 0,
  notes_auto_assigned INTEGER NOT NULL DEFAULT 0,
  notes_auto_created INTEGER NOT NULL DEFAULT 0,
  notes_pending INTEGER NOT NULL DEFAULT 0,
  notes_errored INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
```

### New `app_settings` keys

```
classify.profile_id          → ULID string (optional)
classify.thresholds          → JSON: { existing_min: 0.6, new_bin_floor: 0.75, new_bin_margin: 0.3 }
classify.cron_interval_min   → integer (default 10)
```

### Recently-auto query (drives `/review` card)

```sql
SELECT a.* FROM classification_log a
WHERE a.action IN ('auto_assign', 'auto_create_bin')
  AND a.created_at > (unixepoch() * 1000) - (7 * 86400 * 1000)
  AND NOT EXISTS (
    SELECT 1 FROM classification_log b
    WHERE b.note_id = a.note_id
      AND b.action = 'undone'
      AND b.created_at > a.created_at
  )
ORDER BY a.created_at DESC;
```

### Migration

Single file `migrations/<next-number>-classifier.sql` (numbering picked at plan time from existing `migrations/` directory). Additive only, idempotent (`CREATE IF NOT EXISTS`; SQLite supports `ALTER TABLE … ADD COLUMN` with default values for new columns). Rollback: drop the new tables + the two new `vault_notes` columns (SQLite 3.35+ `DROP COLUMN`, documented in plan).

---

## 6. Classifier Prompt & Output Schema

### LLM input shape (one note per call)

```
[system + bin tree]   ← prompt-cached (5min ephemeral on Anthropic; provider-side on others)
[note content]        ← per-call, unique
```

### System prompt template

```
You are a knowledge organizer for a personal vault. Classify the given note into the
single best-fitting bin from the tree below.

Rules:
1. Return your top-1 best-matching existing bin with a confidence score in [0, 1].
2. If you believe NO existing bin is a good fit, ALSO propose a new bin path under
   an existing parent. Provide a rating in [0, 1].
3. If neither would be appropriate, fill `no_fit_reasoning` and leave both null/low.

Confidence/rating calibration:
  0.9+    = certain
  0.7-0.9 = confident
  0.5-0.7 = likely
  <0.5    = uncertain — say so honestly

Strong preference for existing bins. Only propose new bins when the existing tree
genuinely cannot accommodate the content. Do NOT classify into the `notion-sync`
bin — it is a source holding pen, not a destination.

Bin tree:
{bin_tree_paths_newline_separated}

Return JSON matching this schema:
{
  "existing_match": { "bin_path": string, "confidence": number, "reasoning": string },
  "proposed_new_bin": { "path": string, "rating": number, "reasoning": string } | null,
  "no_fit_reasoning": string | null
}
```

### User message shape

The note content with `bin:` stripped from frontmatter (already used for override decision), body truncated to ~6000 tokens.

### Output schema (zod)

```typescript
const PathRe = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const ClassifierOutput = z.object({
  existing_match: z.object({
    bin_path: z.string().regex(PathRe),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
  }),
  proposed_new_bin: z
    .object({
      path: z.string().regex(PathRe),
      rating: z.number().min(0).max(1),
      reasoning: z.string().min(1),
    })
    .nullable(),
  no_fit_reasoning: z.string().nullable(),
});
```

### Decide logic (`lib/classify/decide.ts`)

```
inputs: parsed (validated), thresholds, binTree (path → id map)

new = parsed.proposed_new_bin
existing = parsed.existing_match

if new is not null:
  margin = new.rating - existing.confidence
  parentExists = binTree.has(parentOf(new.path))
  if new.rating >= thresholds.new_bin_floor
     AND margin >= thresholds.new_bin_margin
     AND parentExists:
    return { action: 'auto_create_bin',
             path: new.path,
             parent_id: binTree.get(parentOf(new.path)),
             slug: tail(new.path),
             name: titleCase(tail(new.path)) }
  // else fall through with new-bin recorded as pending payload

if binTree.has(existing.bin_path) AND existing.confidence >= thresholds.existing_min:
  return { action: 'auto_assign', bin_id: binTree.get(existing.bin_path) }

return { action: 'pending',
         existing_bin_id: binTree.get(existing.bin_path) ?? null,  // null if hallucinated
         existing_confidence: existing.confidence,
         new_bin_path: new?.path ?? null,
         new_bin_rating: new?.rating ?? null,
         no_fit_reasoning: parsed.no_fit_reasoning }
```

### Edge-case handling

| Case | Behavior |
|------|----------|
| `existing.bin_path` doesn't resolve to any DB bin | Treat confidence as 0; route to pending |
| `proposed_new_bin.path` parent doesn't exist | Auto-create gate fails; queue as new-bin proposal (user can edit path on accept to chain creation) |
| `proposed_new_bin.path` already exists in DB (after slug normalization) | Convert silently to existing-bin assignment at the new-bin's rating |
| `no_fit_reasoning` non-null AND existing.confidence high | Trust the explicit signal — route to pending with reasoning shown |
| Title-case slug clash (`okrs` vs `OKRs`) | Slug-normalize before comparison; treat as existing |

---

## 7. `/review` UX

### Page structure

```
/review
├─ [ Run classifier now ] button   (top, prominent; toast on completion)
├─ Last run summary line          (e.g. "10 min ago — 12 seen / 9 auto / 3 pending / 0 errored")
├─ Pending Proposals card         (only rendered if count > 0)
├─ Recently Auto-Classified card  (only rendered if count > 0)
└─ Uncategorized card              (existing v1.2 surface, unchanged)
```

### Pending Proposals — row variants

**Existing-bin proposal (confidence below 0.6):**
```
Title (clickable → reading pane)
→ travel/japan  (0.52)            [show reasoning ▾]
[Accept]  [Reject]  [Pick different bin]  [Stop trying]
```

**New-bin proposal (rating below 0.75 OR margin below 0.3 OR parent missing):**
```
Title
+ create business/planning/okrs  (rating 0.68)
best existing match: business    (0.31)        [show reasoning ▾]
[Accept & create]  [Edit path…]  [Reject]  [Pick existing bin]
```

- "Edit path" expands an inline text input pre-filled with the proposed path. Lets the user create multi-level chains the auto-create gate refuses.
- "Pick different bin" / "Pick existing bin" reuses the BinPicker modal from v1.2.1 (with v1.2.2 keyboard-nav improvements).
- "Stop trying" sets `classifier_skip = 1` immediately.
- Reasoning expansion: full LLM text inline.

### Recently Auto-Classified — row anatomy

```
Title    auto · 3h ago
→ travel/japan/tokyo  (0.91)     [show reasoning ▾] [Undo]
```

```
Title    auto · created bin · 1d ago
+ business/planning/okrs (created)  (0.83)  [show reasoning] [Undo]
```

### Undo mechanics (server)

1. Remove the `note_bins` row for that note + bin
2. If action was `auto_create_bin` AND the bin is now empty → delete the bin (clean reversal)
3. If the bin has other notes → leave bin, just remove this assignment
4. Write `'undone'` row to `classification_log` with `prior_log_id` pointing to original
5. Increment `classifier_attempts`
6. Note becomes re-classifier-eligible on next run (unless attempts hit 3)

### Manual trigger flow

- POST `/api/classify/run`
- Server starts a `classifier_runs` row, runs in-process (single-user, single-machine — no queue)
- Concurrent-run guard rejects with HTTP 409 if a run is in flight
- On completion: response includes summary; toast `"Classified 12 notes — 9 auto, 3 pending"`; both cards refresh
- Long runs: button shows spinner; navigating away doesn't kill the run; return shows updated summary

### Settings — Classifier section

```
Classifier
─────────
Profile             [ dropdown of profiles ]    ← falls back to active chat profile if unset
Cron interval       [ 10 ] minutes
Thresholds
  Existing-bin auto-assign at confidence ≥   [ 0.60 ]
  New-bin auto-create at rating ≥            [ 0.75 ]
  New-bin must beat existing by margin ≥     [ 0.30 ]
  [ Reset to defaults ]
Last run: 10 min ago (12 seen / 9 auto / 3 pending / 0 errored)
[ Run classifier now ]   ← duplicate trigger for convenience
```

### Visual treatment (matches v1.2 retro-futuristic palette)

- Existing-bin proposals: arrow chip `→` with bin path in mono
- New-bin proposals: cyan `+ create` chip, distinct from arrow chip
- Recently-auto: muted `auto` label (settled state, low visual emphasis)
- Confidence/rating: mono digit, no progress bar (denser, more legible)
- Reasoning: prose body, slightly smaller font, indented

### Empty states

- Both cards hide entirely when count = 0 (no visual noise)
- First-run case: one-line onboarding `"Classifier hasn't run yet — set a profile in Settings or click Run now"`

---

## 8. Failure Modes & Mitigations

| Failure | Mitigation |
|---------|-----------|
| LLM 429 | Exponential backoff per note (250ms / 1s / 4s), max 3 retries, then log + skip |
| LLM 401/403 | Abort run; write `error_message`; surface as toast on next `/review` load |
| Network timeout / 500 | Retry once; second failure → log error row, continue batch |
| Malformed JSON | Single retry with strict-JSON follow-up; second failure → log error, skip note |
| Hallucinated bin path | Server lookup fails → confidence treated as 0 → routes to pending |
| Bin deleted mid-run | FK constraint fails on insert → catch, log, skip |
| Note deleted mid-run | Same — FK fail → catch, log, skip |
| Profile deleted | Fall back to active chat profile; if that's also gone → abort run with clear error |
| Machine-key missing | Abort run with re-key-needed error (shared issue with chat API) |
| Concurrent runs | Zero-row INSERT pattern on `classifier_runs` → second run aborts with HTTP 409 |
| Cost runaway | Per-run cap of 100 notes; excess waits for next cron tick (worst case ≈ 600 classifications/hour at 10-min interval, ≈ $0.05/hr at Haiku rates) |
| Classifier loop | 3-strikes auto-skip via `classifier_attempts`; manual "Stop trying" anytime |
| Empty bin tree | Returns new-bin proposals for everything; nothing breaks |

### Things deliberately NOT treated as failures

- LLM returning low confidence — that's a feature, routes to pending
- Notes with empty bodies — classify on title + frontmatter alone
- User editing classifier-skip notes — they remain skipped until user toggles flag off
- LLM proposing a path that already exists (after slug normalization) — converted silently to existing-bin assignment

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM confidence is poorly calibrated → too aggressive auto-assign | Threshold values live in settings; user can raise from 0.6 → 0.7 etc. without redeploy. After 1–2 weeks, calibration histogram (deferred) will inform tuning. |
| Bin tree grows unwieldy in prompt at 100+ bins | Path list is cheap; at 100 bins × ~30 chars/path ≈ 3000 chars input, well within budget. If it grows further, descriptions (Q6 future) provide better signal-per-token than raw paths. |
| User trusts auto-assignments too much, doesn't review | Recently Auto-Classified card surfaces last 7 days prominently in `/review`; quick-undo is one click. |
| Open-weights models (e.g. Kimi K2) have less reliable structured output | Per-note JSON-retry is built in; user can switch profiles in seconds if accuracy degrades. |
| Cron + manual at same time double-classifies a note | Zero-row INSERT concurrent-run guard rejects the second run. |
| User deletes the seeded `notion-sync` bin | Already protected by v1.2.1's DELETE-403 on seeded bins. |
| Auto-created bin has wrong name casing or weird characters | Server slug-normalizes from path tail; `name` defaults to title-case of slug; user can rename via existing right-click. |

---

## 10. Success Criteria

v1.3 ships when:

1. Cron-driven classifier runs at the configured interval (default 10 min); manual trigger button in `/review` works
2. Notes from `notion-sync` + uncategorized are processed; classifier-skip notes are not touched; frontmatter `bin:` notes are pre-assigned by indexer and never reach classifier
3. Auto-assign fires at `existing.confidence ≥ 0.6`; new-bin auto-creation fires only when `rating ≥ 0.75 AND margin ≥ 0.3 AND parent exists`; otherwise pending
4. `/review` Pending Proposals card shows existing-bin (`→`) and new-bin (`+ create`) variants with accept / reject / pick-different / edit-path / stop-trying actions
5. `/review` Recently Auto-Classified card shows last 7 days, with quick-undo that reverses `note_bins` + cleans up auto-created empty bins + writes `'undone'` log row + increments attempts
6. 3-strikes auto-skip works (3 rejections → `classifier_skip = 1`)
7. Settings: profile picker + threshold inputs + cron interval input + last-run summary; threshold changes apply on next run with no restart
8. Catastrophic failures abort cleanly with user-readable error
9. Per-run cap of 100 notes enforced
10. Tests: unit on pure modules; integration on `lib/classify/run.ts` with mock Anthropic client; e2e on `/api/classify/run`
11. Manual smoke: 20+ notes through, mix of auto / pending / new-bin proposals; verify all action paths
12. README: short Classifier section explaining `bin:` override, classifier-skip, threshold tuning, and how to disable (clear classify profile)

---

## 11. Open Question (Deferred)

- Right-click "Re-classify this note" on note rows. Adds API + context-menu complexity for a rare flow. Right-click → Move (existing) covers the explicit-bin case. Defer to v1.4 unless a clear need surfaces during smoke testing.

---

## 12. Implementation Order (Plan Preview)

Plan-time defines the detailed task list. Logical buckets:

1. Migration + queries (data layer)
2. Pure modules (`prompt.ts`, `parse.ts`, `decide.ts`, `profile.ts`) with unit tests
3. `run.ts` per-note flow with integration test against mock LLM
4. `scripts/agent-classify.ts` entry point with concurrent-run guard
5. API routes (run, proposals, undo, classifier-skip)
6. Indexer hook for `bin:` frontmatter override
7. `/review` UI (Pending Proposals card, Recently Auto-Classified card, manual trigger button)
8. Settings UI (profile picker + threshold inputs + cron interval)
9. README + manual smoke
