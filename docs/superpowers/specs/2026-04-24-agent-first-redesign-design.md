# Agent-First Redesign Design Spec (v1.2)

**Date:** 2026-04-24
**Status:** Approved, ready for plan
**Builds on:** `docs/superpowers/specs/2026-04-23-thought-organizer-design.md`

---

## 1. Motivation

Phase 1 and Phase 2 shipped the foundation (vault-as-brain, capture, Notion sync, bins, review, settings), but the UI still feels like a traditional admin dashboard — sidebars with icons, data-dense tables, bins buried as a list inside a legacy `/notes` page. The user's feedback after Phase 2 was blunt: "seems feature weak and shallow still but it works."

The dashboard's actual value is the **knowledge layer + agent**. Phase 1 and 2 built the plumbing; this redesign builds the surface that matches what the product is becoming: a chat-first knowledge organizer backed by an Obsidian vault, with the agent as the primary way you interact with your own information.

The underlying architecture (vault-as-backbone, SQLite-as-metadata) is unchanged. This spec is about the UI surface, interaction model, and the multi-provider agent plumbing that lets the chat actually work.

---

## 2. Scope

**In scope:**
- Full redesign of top-level app layout — chat-primary with a persistent bin-tree sidebar
- Chat mode at `/` (replaces the old dashboard home component)
- Rebuilt `/bins` browse mode replacing the old `/notes` page
- Restyled `/review` and `/settings` to match the new visual language
- Right-side reading pane that opens on note-row click or citation click
- Multi-provider LLM agent (Anthropic native + OpenAI-compatible) with profile management in settings
- Hidden-from-nav: `/clients`, `/projects`, `/agents`, `/files` (data stays, pages retired from primary UI)
- Updated Quick Capture modal and Global hotkey styling to match
- New palette, typography system, icon set

**Out of scope (deferred):**
- Auto-classify agent (suggests bins for uncategorized captures)
- Weekly health-check agent (contradictions, stale info)
- Conversation history persistence across sessions
- Multiple chat sessions / tabs
- Mobile-specific layout (this is a desktop-first Tailscale app; responsive basics only)
- Drag-and-drop bin reorganization
- Smart bins / saved-query bins

**Retired (UI only; data preserved):**
- `/clients`, `/projects`, `/agents`, `/files` routes still exist but are not reachable from primary nav. If a user manually navigates to them they still render. In a later cleanup pass we decide whether to keep them at all.

---

## 3. Architecture

### 3.1 Layout

Fixed two-column (or three-column when reading pane is open):

```
┌──────────────┬───────────────────────────────────┬──────────────┐
│              │                                   │              │
│   SIDEBAR    │          MAIN AREA                │ READING PANE │
│   220px      │          fluid                    │ 340px        │
│              │          (chat or bins-browse     │ (only when   │
│              │           or review or settings)  │  a note is   │
│              │                                   │  open)       │
│              │                                   │              │
└──────────────┴───────────────────────────────────┴──────────────┘
```

- Sidebar: 220px fixed width
- Main area: fluid between sidebar and optional reading pane
- Reading pane: 340px fixed when open; slides in/out

### 3.2 Navigation model

Four top-level surfaces in the sidebar icon strip:

| Icon | Surface | Default URL |
|---|---|---|
| Chat (speech bubble) | conversational agent | `/` |
| Bins (grid) | bin browse / note list | `/bins` |
| Review (crosshair / reticle) | triage surface | `/review` |
| Settings (sliders / compass) | config | `/settings` |

Clicking an icon changes which component renders in the main area. The sidebar's bin tree and footer remain visible across all four surfaces. No top bar above the layout.

### 3.3 State shared across surfaces

- Active top-nav surface (`chat` | `bins` | `review` | `settings`)
- Selected bin (optional, highlighted in tree, affects Chat scope and Bins browse)
- Reading-pane open state + pane content (note ID)
- Global capture modal open/closed

---

## 4. Visual Design Tokens

### 4.1 Palette

```
background-base:     #0d0d0d   (main app background)
background-raised:   #0a0a0a   (sidebar, cards, pane)
background-sunken:   #111      (input fields)
background-hover:    #141414   (hover states, pressed buttons)
border-subtle:       #1a1a1a   (internal dividers)
border-default:      #1f1f1f   (card outlines)
border-strong:       #333      (input borders idle)

text-primary:        #ede8d8   (body text, headings — warm off-white)
text-secondary:      #c9c6b7   (secondary body text)
text-tertiary:       #a09e96   (de-emphasized content, bin note counts)
text-muted:          #8e8c85   (metadata, labels)
text-subtle:         #6e6c66   (placeholder text, "Ask your workspace")
text-dim:            #4a4944   (disabled, help text, status footers)

accent:              #7dd3fc   (cyan — focus states, active nav, citations, good signals)
accent-glow:         rgba(125, 211, 252, 0.06)  (glow around focused inputs)
accent-tint:         rgba(125, 211, 252, 0.04)  (active-row background)
accent-border:       rgba(125, 211, 252, 0.08)  (subtle accent borders)
```

### 4.2 Typography

- **Body / UI:** `Inter` (400 / 500 weights; no bold abuse — 500 is the "bold")
- **Monospace:** `JetBrains Mono` for labels, counts, metadata, timestamps, code, keyboard shortcuts
- **Font sizes** (px):
  - 22 — page title
  - 17 — section title in reading pane
  - 14 — chat input text, h2 in content
  - 12 — primary body text
  - 11 — secondary / metadata
  - 10 — mono labels, counts, breadcrumbs
  - 9 — footer, ultra-small labels
- **Letter spacing:**
  - Uppercase mono labels: `0.08–0.10em`
  - Body text: `-0.01em` (tightened)
- **Line height:**
  - Body text: `1.6`
  - Reading content: `1.65`
  - Sidebar bin tree: `1.8` (tighter for compactness)

### 4.3 Iconography

Retro-futuristic thin-line monochrome SVGs.

- Stroke width: `1.25`
- Size: `14px` in sidebar nav strip; `12px` inline actions (close, expand, open-external)
- Stroke color: `text-primary` (off-white) when active, `text-muted` when idle
- No fill, no gradients, no color variants

Icon set (hand-drawn inline SVG, not a library):
- **Chat** — speech bubble with a chat tail (rectangle with triangular tail)
- **Bins** — 2×2 grid of squares
- **Review** — circle with compass marks at N/E/S/W (reticle)
- **Settings** — 8-point radial burst with center circle (astronaut-suit control)
- **Search** — circle with diagonal line
- **Close** — two crossed lines
- **External link** — bracket indicating "opens elsewhere"
- **Chevron** — for dropdowns and tree expanders

### 4.4 Spacing and borders

- Cards: `1px solid border-default` on `background-raised`, `border-radius: 6px`, `padding: 18px`
- Inputs: `1px solid border-strong` idle, `1px solid accent + 3px accent-glow` focused, `border-radius: 6px`, `padding: 10–14px`
- Sidebar items: no borders; use `background-hover` on hover, `accent-tint + 2px accent left-border` on active/selected
- Grid gaps: `16px` between cards, `8px` between items in a list, `2px` between rows in a note list

---

## 5. Primary Surfaces

### 5.1 Sidebar (always visible)

**Top strip (48px tall):** 4 icons (Chat / Bins / Review / Settings). The active icon is cyan; others are muted. Single click switches the main area surface.

**Search bar:** A small input `"search bins"` with a search icon. Focus via `/` hotkey or click. Filters the bin tree inline as you type — non-matching branches collapse, matches highlight.

**Bin tree:** Nested, expand/collapse via chevron (`▸` / `▾`). Each bin shows `name · count` in JetBrains Mono. Hover: `background-hover`. Active / scoped: `accent-tint` bg + `2px accent` left border. Right-click (v1.5) = context menu for rename/merge/delete.

**Footer (28px tall):** `synced Xm ago` in mono, with a small cyan dot for fresh (< 10 min) or dim for stale. Clickable → opens Settings → Sync Health.

### 5.2 Chat mode (default `/`)

**Empty state** (no active conversation):
- Greeting in uppercase mono (`GOOD MORNING, CARTER`)
- Large centered prompt: `Ask your workspace` (22px off-white)
- Input box: `width: min(480px, 100%)`, focused border = cyan with glow
- Below input: three suggested prompts as ghost chips (pre-filled based on recent captures + active bins)
- Bottom hint: `↵ send · ⌘K commands · ⌘⇧C capture` in small mono, with the shortcut keys in cyan

**Active conversation:**
- Top bar (below the main layout, inside chat area): shows `SCOPE` label + the active scope badge if one is set (e.g. `content / reels / tokyo`) in cyan outline. Plus `claude-opus-4-7` (or whatever model) on the right in dim mono.
- Messages area scrolls. User messages: right-aligned, `background-raised` with subtle border, `border-radius: 8px 8px 2px 8px`. Agent messages: left-aligned, no bubble, just prose on the base background. Spacing: `18px` between messages.
- Agent messages end with a **citation row** — chips with `↗ filename.md` in cyan mono inside a bordered pill. Clicking a chip opens the reading pane.
- Input at bottom, always visible, pinned. Above input: a subtle `1px` top border.

### 5.3 Bins browse mode (`/bins` or `/bins/[id]`)

**Two-section layout inside main:**
1. **Header:** breadcrumb (`content / reels / tokyo` in mono uppercase) + bin title (22px) + note count + filter chips (`all` / `obsidian` / `notion` / `capture`) aligned right
2. **Note list:** one row per note. Columns: title (flex), source badge (mono), modified-at (mono right). Click row = opens reading pane. No per-note expand/collapse.

**Empty bin:** centered mono message: `no notes in this bin yet`.

**Default route (`/bins` with no bin selected):** shows a note list of recently modified notes across all bins, plus a small prompt: `pick a bin from the sidebar`.

### 5.4 Review (`/review`)

2×2 grid of cards:
- **TODAY** — notes modified since start of day
- **UNCATEGORIZED** — notes in no bin
- **RECENT · 7D** — last 7 days
- **STALE BINS · 30D+** — bins with no new activity in 30+ days

Each card: `background-raised`, 18px padding, title in mono uppercase with a count chip on the right.

Today card: each row has a cyan left border + `accent-tint` background for rows from the current session (< 2h old). Rows are clickable → open reading pane.

Stale-bins card: single line per bin with name (left) + `last X ago` or `empty` (right, in dim mono).

### 5.5 Settings (`/settings`)

Grid of 4 cards:

**Provider Profiles** (see §7)
- Active profile highlighted with cyan border + glow
- Inactive profiles in a list, click to set active
- `+ add profile` button top-right of card
- Clicking a profile opens an inline edit form

**Notion Sync Targets**
- Textarea for page IDs, one per line
- Save button (cyan fill) + target count

**Actions**
- Ghost buttons: "run vault indexer", "re-seed bins from folders", "run notion sync"
- Each shows "Running… / Done ✓" inline status on click

**Sync Health**
- Compact list in mono: `sync-name  ● Xm ago`
- Cyan dot for fresh (< 10 min), dim for older
- Pulls from `sync_status` table

### 5.6 Reading pane (right side, conditional)

Opens on: note-row click in bins-browse, citation chip click in chat, or programmatically.

**Width:** 340px fixed.
**Dismiss:** `×` icon top-right OR clicking another note (pane swaps content).
**Header:** small `reading` mono label + "Open in Obsidian" icon (→ `obsidian://open?path=...`) + close.
**Body:**
- Mono label (source · relative-time)
- Title (17px)
- Tag chips (from frontmatter)
- Markdown content rendered (react-markdown + remark-gfm as in Phase 1)
- Bottom: "In bins" section with bin chips

The pane coexists with any main-area surface. In chat mode, the pane covers the right portion of the chat — messages remain visible but narrower. User can keep chatting while reading.

### 5.7 Quick Capture modal (restyled)

Same behavior as Phase 2 (⌘⇧C, textarea, bin picker, tags). Visual restyle only:
- Backdrop: `rgba(0,0,0,0.7)` with `backdrop-filter: blur(6px)`
- Modal: `background-raised`, `1px border-default`, `border-radius: 10px`, `max-width: 560px`
- Input: same focus style (cyan border + glow)
- Submit button: cyan fill, dark text
- Keyboard hints in small dim mono: `⌘⏎ submit · esc cancel`

---

## 6. Interaction Model

### 6.1 Bin click behaviors

- **Click bin name** (in sidebar tree) → scopes the active chat to that bin. If currently in Chat mode, a cyan scope badge appears (`content / reels / tokyo`). If currently in Bins mode, main area navigates to `/bins/[bin-id]`.
- **Click expand arrow** (chevron) → toggles the sub-tree. Does not change scope or route.
- **Double-click bin name** (v1.5, optional polish) → forces navigation to `/bins/[bin-id]` regardless of current mode.

### 6.2 Citation click

Clicking a `↗ filename.md` chip in a chat response:
- Opens the reading pane with that note's content
- Does not change active surface (you stay in chat)
- If pane is already open, swaps content

### 6.3 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘⇧C` (Cmd+Shift+C) | Open Quick Capture modal |
| `/` | Focus sidebar search input |
| `⌘K` | Command palette (deferred to v1.3) |
| `↵` (in chat input) | Send message |
| `⇧↵` (in chat input) | New line |
| `⌘↵` (in chat input) | Send message (alt) |
| `esc` (in modal/pane) | Close it |

### 6.4 Scope badge

When a bin is scoped to the chat, a badge shows: `content / reels / tokyo` in cyan outline with a small `×` to clear. The agent only retrieves from notes in the scoped bin + descendants. Scoping is ephemeral — persists until user clears it or starts a new chat.

---

## 7. LLM Provider System

### 7.1 Provider types

Two code paths, one unified interface:

1. **`anthropic`** — uses `@anthropic-ai/sdk` directly. Supports prompt caching, extended thinking, proper tool use. Only works with Claude models. Base URL is fixed (`https://api.anthropic.com`).

2. **`openai-compatible`** — uses the `openai` SDK with a custom `baseURL`. Covers OpenRouter, Moonshot Kimi direct, Together, Groq, local LM Studio/Ollama, anything speaking the OpenAI chat-completions protocol. Model name is free-form.

### 7.2 Profile shape

Stored in `app_settings` under key `llm.profiles` (JSON array) and `llm.active_profile_id` (string).

```typescript
interface LlmProfile {
  id: string;                          // ulid
  name: string;                        // "Claude direct" / "OpenRouter" / "Local LM Studio"
  type: "anthropic" | "openai-compatible";
  api_key_encrypted: string;           // encrypted at rest
  base_url?: string;                   // required for openai-compatible
  default_model: string;               // e.g. "claude-opus-4-7" or "moonshotai/kimi-k2.6-thinking"
  cache_enabled?: boolean;             // anthropic only, default true
  created_at: string;                  // iso
}
```

### 7.3 API key encryption

API keys are sensitive. Encrypted at rest in SQLite using `aes-256-gcm` with a machine-local key stored at `~/.config/dashboard/machine-key` (mode `0600`). Key is generated on first launch if absent. Rationale: the dashboard is Tailscale-only and filesystem access is already gated by the OS, but encrypted storage means a casual `sqlite3 data/dashboard.db .dump` leak doesn't reveal secrets.

### 7.4 Abstraction layer

```
lib/llm/
├── types.ts          — LlmProfile, LlmMessage, LlmStreamChunk types
├── chat.ts           — streamChat(messages, options) entry point
├── anthropic.ts      — Anthropic-native provider implementation
├── openai-compat.ts  — OpenAI-compatible provider implementation
├── encryption.ts     — AES-GCM wrappers for API keys
└── profiles.ts       — CRUD on profiles in app_settings
```

`streamChat` returns an `AsyncIterable<LlmStreamChunk>` where each chunk is `{ type: "text", text: string } | { type: "done", usage: {...} }`. The `/api/chat` route wraps this in an SSE stream for the frontend.

### 7.5 Migration from existing env vars

On first launch after v1.2 deploys:
- If `ANTHROPIC_API_KEY` env var is set and no profiles exist: create a default `anthropic` profile with name `"Claude direct"`, `default_model: "claude-opus-4-7"`, `cache_enabled: true`. Mark it active.
- `NOTION_TOKEN` is unchanged — stays as env (it's not an LLM provider).

### 7.6 Default model recommendations (help text in settings)

When user clicks `+ add profile`, the form shows contextual help:
- `anthropic`: suggests `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- `openai-compatible`: suggests `moonshotai/kimi-k2.6-thinking`, `anthropic/claude-sonnet-4-6`, `openai/gpt-5.1`, `meta-llama/llama-3.3-70b-instruct` (OpenRouter model naming)
- Free-form field; user can type anything

---

## 8. Retrieval Strategy (Chat)

When the user sends a message, `/api/chat`:

1. Parses the active scope (if any bin is scoped)
2. Runs FTS5 query using the user's message text (lowercased, whitespace-normalized, wrapped in FTS5 phrase quoting) as the MATCH expression, ranked by relevance
3. If a scope is active, intersects FTS hits with notes in the scoped bin + descendants
4. Takes top 10 hits + content of top 5 (full markdown, frontmatter stripped)
5. Also includes: 5 most recently modified notes from the scoped bin (or across all bins if no scope), to provide recency signal
6. Builds the prompt:
   - **System:** `"You are the agent for Carter's personal knowledge vault. Answer ONLY using the provided notes. Cite sources by vault_path. If the answer isn't in the notes, say so explicitly. Be concise."`
   - **User:** Chat history (if any in current session) + retrieved notes as context blocks + the new user message
7. Streams response via the active profile's provider
8. Parses citations: response is expected to include `vault_path` references; frontend renders them as clickable chips

Token budget under Opus 4.7 (1M context): generous. Even 20 full notes × 5KB = 100KB context, leaves plenty for output. For smaller-context models (Kimi K2 at 128K): limit to top 8 full notes, dropping recency slots first.

---

## 9. Schema Changes

Only additions — no breaking changes to Phase 1/2 schema.

```sql
-- No new tables. Everything fits in app_settings.
-- Keys used by this feature:
--   'llm.profiles'            → JSON array of LlmProfile
--   'llm.active_profile_id'   → ulid string
--   'ui.sidebar_width'        → px (defaults to 220; user can resize later)
--   'ui.reading_pane_width'   → px (defaults to 340)
```

Existing `app_settings` table from v1.1 handles all of this. No migration script needed beyond the env-var migration in §7.5.

---

## 10. Retired / Hidden

The following Phase 1 pages are **removed from primary navigation** but remain reachable at their URLs. Their data (clients, projects, agents, files tables in SQLite) is untouched.

| Old surface | What happens |
|---|---|
| `/clients` | URL still renders, but no nav link. `listClients()` still used by Capture (for attaching to a client) and potentially by future bin operations. |
| `/projects` | URL still renders. Projects data keeps syncing via `sync-projects.ts`. |
| `/agents` | URL still renders. `sync-agents.ts` still runs. |
| `/files` | URL still renders. |
| Existing `/notes` | **Deleted.** Replaced by `/bins` browse mode. |
| Existing `/` dashboard home | **Deleted.** Replaced by chat mode (new `/`). |

Data from these tables is preserved because (a) it might be useful again later (e.g. "mention a client from chat, agent pulls their context"), and (b) removing data is riskier than removing UI. If the user decides later that these pages should be fully deleted, that's a separate small cleanup.

---

## 11. Deferred to Future Plans

**v1.3 Agent extensions:**
- Auto-classify agent (on capture without a bin → agent suggests one; surfaces in Review's Uncategorized)
- Weekly health-check agent (cron; finds contradictions, stale info; writes report to `~/Vault/wiki/`)
- Command palette (`⌘K`)

**v1.4 Chat depth:**
- Conversation history persistence (SQLite `chat_sessions` + `chat_messages` tables)
- Multiple chat tabs
- Pin conversations
- Export conversation as a markdown note back to the vault

**v1.5 Bin depth:**
- Drag-and-drop bin reorganization
- Smart bins / saved queries ("all notes tagged #urgent not in `archive/`")
- Context menu on bins (rename, merge, delete with confirm)
- Bulk bin operations

**v2 Deployment:**
- Mac Mini deploy automation
- Launchd plists + cron entries
- iCloud sync verification scripts

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sidebar bin tree gets unwieldy at 50+ bins | Search is always-on (`/` hotkey). v1.5 adds depth-collapse ("show only top 2 levels"). |
| Citation parsing relies on agent output format being consistent | Use XML-ish structured output in the prompt (`<cite path="..."/>`) to make parsing unambiguous. Fall back to path-matching via regex if XML absent. |
| Multi-provider support expands the test surface | Mock the LLM in unit tests; integration tests cover one provider type (anthropic) end-to-end; manual smoke test covers profile switching. |
| Encrypted API key loss (machine-key file deleted) | On startup, if the key file is missing but profiles exist with encrypted keys, surface a clear error + regeneration flow. Back up the key as part of Mac Mini deploy setup. |
| OpenAI-compatible endpoints vary in streaming format | Use `openai` SDK's iteration interface; most providers are compliant. If one isn't, add a provider-specific adapter inside `openai-compat.ts`. |
| Token limits differ across models | Per-profile `max_context_tokens` field (default `200_000`). Retrieval layer respects it when assembling context. |
| Chat streaming disconnection mid-response | Frontend gracefully shows partial response + "(connection lost)" note; user can retry. |
| Existing pages retired but data orphaned | Data stays untouched. If a user manually types `/clients` it still works. |

---

## 13. Success Criteria

v1.2 ships successfully when:

1. Opening the dashboard at the Tailscale URL lands on chat mode with the empty-state layout described in §5.2
2. The sidebar shows the user's full bin tree, searchable, with fresh sync-status indicator at bottom
3. Typing a question and pressing Enter streams a response back within 3 seconds of first token, with at least one citation link in typical queries
4. Clicking a citation or note row opens the reading pane on the right without navigation
5. Clicking a bin in the sidebar scopes the chat (badge appears) or navigates to bin view depending on current mode
6. Settings page lets user add, switch, and delete provider profiles — all three provider types (Anthropic direct, OpenRouter, local) can be configured and tested from the UI
7. The old `/clients`, `/projects`, `/agents`, `/files` nav items are gone but URLs still work if typed manually
8. `/review` and `/settings` reflect the new visual language (palette, mono labels, cyan accents, ghost buttons)
9. Full test suite remains green (new tests added for LLM abstraction, profile CRUD, retrieval assembly)
10. Quick Capture (⌘⇧C) and vault indexer continue to work exactly as before

---

## 14. Appendix: Visual References

Design mockups referenced during brainstorming live at `.superpowers/brainstorm/78327-1777032305/content/`:
- `landing-layout.html` — chat-primary vs bins-primary vs hybrid
- `bin-surface.html` — persistent sidebar vs slide-in vs dedicated page
- `sidebar-scope.html` — minimal nav chosen
- `palette.html` — monochrome vs accent (accent chosen)
- `chat-mode.html` — empty + active states
- `bins-mode.html` — bin browse with reading pane open
- `review-settings.html` — updated aesthetic for both
- `provider-profiles.html` — multi-provider settings card

These are not design source-of-truth (this document is) — they're reference artifacts from the brainstorm session and may drift from the final spec.
