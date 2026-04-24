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
- New dependencies: `@anthropic-ai/sdk` and `openai` (neither currently installed — Phase 2 installed `@notionhq/client` only)
- Hidden-from-nav: `/clients`, `/projects`, `/agents`, `/files` (data stays, pages retired from primary UI)
- New `POST /api/actions/sync-notion` endpoint to match the "run notion sync" button in Settings Actions (§5.5)
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

### 4.5 States, transitions, and responsive rules

**Disabled:** any interactive element with `disabled` attribute gets `opacity: 0.45`, `cursor: not-allowed`, no hover transitions. Applies to buttons, inputs, bin rows during loading.

**Loading / skeleton:**
- Chat streaming: blinking thin-caret cursor appears at the trailing edge of the agent's in-progress message (`animation: caret-blink 1s infinite`). Cursor is cyan.
- Bin tree on first fetch: skeleton bars (three 10px-tall dim rectangles inside the sidebar body) until the bin tree resolves.
- Note list on bin change: skeleton bars (five 16px-tall rows in the main area) during fetch.

**Scrollbars:** Use `scrollbar-width: thin; scrollbar-color: #333 transparent;` (Firefox) and `::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }` (WebKit). Track is transparent; thumb is `#333` default, `#4a4944` hover.

**Reading-pane transitions:** `transition: transform 200ms ease-out, opacity 200ms ease-out`. Open: `translateX(0)` + opacity 1. Closed: `translateX(100%)` + opacity 0. Main area width changes via CSS grid column sizing (no JS animation needed).

**Z-index stacking:**
```
10   sidebar (fixed position, low but above base)
20   reading pane
30   scope badge, tooltips
50   dropdowns (profile edit form, provider type selector)
60   modals (Quick Capture, "delete bin" confirm, machine-key-lost recovery)
70   toast notifications
```

**Responsive breakpoints** (basic only — this is a desktop-first Tailscale app):
- `< 900px` (`md` breakpoint): reading pane becomes full-screen modal instead of side panel; clicking a note opens it as a modal, close via `×` or Esc.
- `< 640px` (`sm`): sidebar collapses to icon strip only (48px); bin tree accessible via a slide-out hamburger menu; nav icons remain visible. This is a low-priority optimization — accept that the app is awkward on phones.

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

**Error states:**
- **No profiles configured (first run):** replace the empty-state hero with a card titled "Configure your first LLM profile" with a primary button linking to `/settings`. Suggested prompts are hidden.
- **Profile key invalid (HTTP 401 from provider):** inline red toast at bottom-right: `API key invalid — check Settings → Profiles`. Toast auto-dismisses after 6s.
- **Rate limited (HTTP 429):** amber toast: `Rate limited. Retry in Xs.` where X comes from the `Retry-After` header (default 30).
- **Provider 5xx or network error:** amber toast: `Agent unavailable — {short message}. Check your provider.` Message is streamed in-place in the assistant bubble as `(agent unavailable)` if partial response existed.
- **Zero notes retrieved:** agent still sends the request with a system note that context is empty. If the agent response acknowledges no context, render it normally; no special UI. If retrieval fails entirely (FTS5 error), surface a red toast: `Search failed — see console`.
- **Machine key missing on send:** block submission, show modal (see §7.3).

**First-run experience:** if `app_settings` has no `llm.profiles`, chat is gated. If bins are empty, sidebar shows a muted message `No bins yet. Run Settings → Re-seed bins.` If the vault is empty, suggested prompts are hidden from chat empty-state (they'd have nothing to reference).

### 5.3 Bins browse mode (`/bins` or `/bins/[id]`)

**Two-section layout inside main:**
1. **Header:** breadcrumb (`content / reels / tokyo` in mono uppercase) + bin title (22px) + note count + filter chips (`all` / `obsidian` / `notion` / `capture`) aligned right
2. **Note list:** one row per note. Columns: title (flex), source badge (mono), modified-at (mono right). Click row = opens reading pane (does NOT navigate). No per-note expand/collapse.

**NoteList component change:** the existing `components/NoteList.tsx` wraps each row in `<Link href="/notes/${n.id}">`. For v1.2, replace that with an `onNoteClick?: (note: VaultNote) => void` prop. The Bins page passes a handler that opens the reading pane. The old `/notes/[id]` page remains addressable as a deep-link fallback (direct URL navigation), but internal clicks use the pane.

**Empty bin:** centered mono message: `no notes in this bin yet`.

**Default route (`/bins` with no bin selected):** shows a note list of recently modified notes across all bins, plus a small prompt: `pick a bin from the sidebar`.

**Routing:** Bins mode uses a dynamic route `app/bins/[id]/page.tsx` that renders the same browse component as `app/bins/page.tsx` but pre-selects the bin from the URL param. The sidebar's `selectedBin` state syncs from the URL on mount and updates the URL on clicks via Next's `router.push`. Direct URL navigation and internal clicks converge on the same state.

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
- "run notion sync" requires a new endpoint: `POST /api/actions/sync-notion` that spawns `tsx scripts/sync-notion.ts` with a 120s timeout (longer than other actions because Notion API is slower). Similar pattern to existing `reindex` and `seed-bins` action routes, but note that `scripts/sync-notion.ts` reads its configuration (`VAULT_PATH`, `NOTION_TOKEN`) from environment variables and takes no CLI arguments — so the spawn call passes env via `spawnSync` options rather than `--vault` args.

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

### 6.1 Bin click behaviors and mode switching

Two pieces of app state matter: `activeMode` (chat | bins | review | settings) and `selectedBin` (bin id or null).

**Click bin name** (in sidebar tree):
- Always sets `selectedBin` to that bin id. This is the universal effect — the bin is "selected" regardless of mode.
- If `activeMode === chat`: a cyan scope badge renders above the messages. The next chat message uses that bin's notes for retrieval.
- If `activeMode === bins`: main area navigates to `/bins/[bin-id]` to show its note list.
- If `activeMode` is review or settings: no navigation — the bin is selected (highlighted in sidebar) but the main area stays put. Useful precondition: user can click a bin, then click the Chat icon, and land in chat already scoped.

**Click the currently selected bin again** (whether name or row): clears selection (`selectedBin = null`). Scope badge disappears in chat mode. In bins mode, main area navigates to `/bins` (the default unselected view).

**Click a different bin**: replaces selection with the new bin. No special UI flicker — the active-row highlight animates.

**Click expand arrow** (chevron): toggles the sub-tree only. Does not change selection, scope, or route.

**Switching top-nav icons preserves `selectedBin`**:
- Chat (scoped to bin A) → click Bins icon → lands on `/bins/bin-A` (bin still selected, now showing its notes).
- Bins (viewing bin A) → click Chat icon → lands on chat with scope pre-set to bin A.
- Reading pane state is orthogonal — pane stays open across nav icon clicks (it's a side layer, not part of the active mode's content).

**Double-click bin name** (v1.5, optional polish): forces navigation to `/bins/[bin-id]` regardless of current mode. Not in v1.2.

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

### 6.4 Scope badge and ephemerality

When a bin is scoped to the chat, a badge shows: `content / reels / tokyo` in cyan outline with a small `×` to clear. The agent only retrieves from notes in the scoped bin + descendants.

**Scope persistence in v1.2:** since conversation history is not persisted (deferred to v1.4), every full page reload is effectively a new chat. Scope is stored in React state only, not in the URL or localStorage. Reloading clears the scope. Navigating between top-nav icons does NOT clear scope (it carries, as described in §6.1).

**"New chat" action** (v1.4): when conversation history ships, a "new chat" button will clear the message history AND the scope.

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
  api_key_encrypted: string;           // AES-256-GCM ciphertext, base64; includes iv + auth tag
  base_url?: string;                   // required for openai-compatible
  default_model: string;               // e.g. "claude-opus-4-7" or "moonshotai/kimi-k2"
  max_context_tokens: number;          // retrieval budget; enforces per-model context limits
  created_at: string;                  // iso
}
```

**`max_context_tokens` defaults when adding a new profile:**
- `anthropic` + claude-opus-4-7 / claude-sonnet-4-6: `200_000`
- `anthropic` + claude-haiku-4-5: `200_000`
- `openai-compatible` + OpenRouter generic: `128_000`
- `openai-compatible` + local/unknown: `32_000` (conservative)

The user can override the default in the profile form. The retrieval layer reads this value to cap context bytes (see §8.1).

**Prompt caching:** intentionally omitted from v1.2. Anthropic's prompt caching requires `cache_control` markers on content blocks ≥1024 tokens and is most useful when the same system prompt is reused across many requests. Without conversation history persistence (v1.4), there's limited benefit to caching per-request. Revisit in v1.4.

### 7.3 API key encryption

API keys are sensitive. Encrypted at rest in SQLite using `aes-256-gcm` via Node's builtin `crypto` module (no dependency) with a machine-local key stored at `~/.config/dashboard/machine-key` (mode `0600`, 32 random bytes). Key is generated on first launch if absent. Rationale: the dashboard is Tailscale-only and filesystem access is already gated by the OS, but encrypted storage means a casual `sqlite3 data/dashboard.db .dump` leak doesn't reveal secrets.

**Recovery UX when the machine-key is missing or unreadable** (e.g. user reset `~/.config`, copied DB to a new machine without copying the key, permissions broke):

On app startup, the server checks: does `~/.config/dashboard/machine-key` exist AND is it readable AND is the first 32 bytes valid?
- If yes: continue normally.
- If no AND `app_settings` has no `llm.profiles`: silently generate a new key. User is a first-time setup, nothing to lose.
- If no AND `app_settings` HAS existing `llm.profiles` with non-empty `api_key_encrypted`: block app startup by returning a full-screen modal (route all requests to a recovery page). Modal copy:

  > **Machine key missing**
  >
  > Your local encryption key (`~/.config/dashboard/machine-key`) can't be read. API keys stored in your LLM profiles are encrypted with this key and **cannot be recovered without it**.
  >
  > If you deleted it by accident, restore from backup and restart.
  >
  > Otherwise, you must delete the encrypted profiles and re-enter your API keys.
  >
  > **[ Delete all profiles and start fresh ]**

  The button clears `llm.profiles` + `llm.active_profile_id` from `app_settings`, generates a new machine-key, and reloads. Other dashboard data (notes, bins, sync state) is unaffected — this only drops the LLM profiles.

Encryption format: `iv (12 bytes) || authTag (16 bytes) || ciphertext` base64-encoded into the `api_key_encrypted` string.

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
- If `ANTHROPIC_API_KEY` env var is set and no profiles exist: create a default `anthropic` profile with name `"Claude direct"`, `default_model: "claude-opus-4-7"`, `max_context_tokens: 200_000`. Mark it active.
- `NOTION_TOKEN` is unchanged — stays as env (it's not an LLM provider).

### 7.6 Default model recommendations (help text in settings)

When user clicks `+ add profile`, the form shows contextual help:
- `anthropic`: suggests `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- `openai-compatible`: suggests `moonshotai/kimi-k2.6-thinking`, `anthropic/claude-sonnet-4-6`, `openai/gpt-5.1`, `meta-llama/llama-3.3-70b-instruct` (OpenRouter model naming)
- Free-form field; user can type anything

---

## 8. Retrieval Strategy (Chat)

When the user sends a message, `/api/chat`:

1. **Parse scope.** Read the active scope (if any bin is scoped); resolve its descendants to a set of `vault_notes.id`.
2. **Build FTS5 MATCH expression.** Take the user's message, lowercase it, collapse whitespace, then wrap in phrase quoting: `safeQuery = '"${message.replace(/"/g, '""')}"'`. This matches the canonical sanitation already used by `app/api/notes/search/route.ts` — reuse that helper. Reason: raw user input can contain FTS5 operators (`"`, `*`, `NOT`, etc.) that cause SQLite syntax errors.
3. **Run FTS5 query.** Use `searchVaultNotes(safeQuery, 20)` from Phase 1's `lib/queries/vault-notes.ts`. Intersect with scoped note IDs if scope is set.
4. **Assemble context** under a byte budget:
   - Load full file contents (via `fs.readFileSync(path.join(VAULT_PATH, note.vault_path), "utf-8")`) for each candidate note, top of FTS ranks first.
   - Strip frontmatter using the existing `parseFrontmatter` from `lib/vault/frontmatter.ts` (Phase 1).
   - Accumulate byte count. Stop adding notes when `accumulated_bytes × 4 > profile.max_context_tokens × 0.6` (reserving 40% of the window for output + prompt scaffolding + chat history). The `× 4` is a rough bytes-per-token heuristic — simple and defensible for English markdown.
   - Always include at least 3 notes if any match; truncate the last note's content if it alone exceeds budget.
5. **Add recency slots.** After FTS hits, append up to 5 most recently modified notes from the scoped set (or across all bins if unscoped) that aren't already included. Subject to the same byte budget.
6. **Build the prompt:**
   - **System:** `"You are the agent for Carter's personal knowledge vault. Answer ONLY using the provided notes. Be concise. After your prose answer, emit a <citations>...</citations> block listing the vault_paths you used, one per <cite path=\"…\"/> element. If the answer isn't in the notes, say so plainly and emit an empty <citations/>."`
   - **User:** `Chat history (current session) + context blocks formatted as "=== vault_path ===\n{content}\n" for each note + the new user message.`
7. **Stream response** via the active profile's provider through the `lib/llm/chat.ts` abstraction.
8. **Parse citations.** Primary strategy: scan the streamed response for the trailing `<citations>…<cite path="…"/>…</citations>` block and extract paths. Render each as a chip. Fallback (if the `<citations>` block is absent — model didn't comply): regex-scan the response body for exact `vault_path` strings from the retrieved set. Frontend de-duplicates by path.

**Token budget notes:**
- A single large note (30KB+) is common in long-form vaults. The byte-budget assembler in step 4 handles this by dropping or truncating — prevents one note from monopolizing context.
- `profile.max_context_tokens` is the authoritative budget source; the code reads it from the active profile (see §7.2), never hardcodes by model name.
- For very small models (local 8B, 32K context): 19KB of context max (32K × 0.6 × bytes/token). Expect 3-5 notes at most. Acceptable degradation.

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
| `/clients` | URL still renders with the new layout (sidebar + main). A retired banner shows at the top of the page. |
| `/projects` | Same — URL still renders with retired banner. Projects data keeps syncing via `sync-projects.ts`. |
| `/agents` | URL renders with retired banner. `sync-agents.ts` still runs. |
| `/files` | URL renders with retired banner. |
| `/notes` (list) | **Replaced.** The `app/notes/page.tsx` is rewritten as a server component that calls `redirect("/bins")` from `next/navigation`. No client-side flash. |
| `/notes/[id]` | **Kept addressable.** Direct-link URLs still render the note detail view (for sharing, bookmarking), but internal clicks use the reading pane instead. |
| Existing `/` dashboard home | **Replaced.** `app/page.tsx` now renders chat mode. |

**Retired banner component** (new): a thin bar at the top of retired pages:
```
This page is retired from the primary nav. [Go to Chat →]
```
Off-white text on `background-hover`, with the link in cyan. Dismissible? No — if this page is still used, it's a deep-link reach and the banner is a useful signal.

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
| Multi-provider support expands the test surface | `lib/llm/chat.ts` returns an `AsyncIterable<LlmStreamChunk>` — unit-testable by mocking the provider to yield fake chunks. `app/api/chat/route.ts` is thin glue that wraps the iterable as an SSE `ReadableStream`; tested with a mock provider or covered by manual smoke. Integration test uses the Anthropic adapter against a stubbed fetch. OpenAI-compatible is tested against OpenRouter for one request in manual smoke. |
| Accessibility gaps on new UI | Minimum a11y baseline: icon buttons have `aria-label`; bin tree uses `role="tree"` with `aria-expanded`/`aria-selected`; reading pane focuses on open and traps focus (Esc closes); chat input has `aria-label="Chat input"`; all focus states use `:focus-visible` with a 2px cyan outline. Deferred to v1.3: screen reader testing, high-contrast mode. |
| Suggested prompts generation unclear | v1.2 uses a simple rule: take the 3 most recently modified notes (across all bins); generate prompt templates `Summarize {note.title}`, `What did I note about {first-tag-or-first-word}`, `What's in {top-level-bin}`. No LLM call to generate prompts — it's deterministic. If no notes exist, prompts are hidden. Smarter generation deferred to v1.3 agent work. |
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
6. Settings page lets user add, switch, and delete provider profiles — both provider types (Anthropic direct and OpenAI-compatible, including OpenRouter and local endpoints as sub-configurations) can be configured and tested from the UI
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
