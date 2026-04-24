# Agent-First Redesign Implementation Plan (v1.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard as a chat-primary knowledge tool backed by the Obsidian vault, with a persistent bin-tree sidebar, multi-provider LLM agent, and a visual redesign (dark gray + off-white + cyan accent, retro-futuristic white line icons).

**Architecture:** Three new layers on top of Phase 1/2 infrastructure. (1) `lib/llm/*` abstraction with Anthropic-native + OpenAI-compatible providers, encrypted profile storage, streaming chat. (2) Retrieval pipeline that assembles context from vault files under a per-profile byte budget using the existing FTS5 index. (3) Full UI redesign: new layout, new sidebar, new chat page at `/`, new Bins browse at `/bins`, restyled Review and Settings, right-side reading pane. All built on the existing vault-as-backbone + SQLite-metadata architecture.

**Tech Stack:** Same foundation — Next.js 14 App Router, better-sqlite3, Vitest, Tailwind v3. Adds `@anthropic-ai/sdk` and `openai` (SDK for all OpenAI-compatible providers). Uses Node builtin `crypto` for AES-256-GCM encryption.

**Spec reference:** `docs/superpowers/specs/2026-04-24-agent-first-redesign-design.md`

**Builds on:** Phase 1 (`docs/superpowers/plans/2026-04-23-thought-organizer-v1-foundation.md`) and Phase 2 (`docs/superpowers/plans/2026-04-24-thought-organizer-v11-capture-notion-review.md`). Assumes 123 tests passing, full vault/bin/notion/review/settings infrastructure present.

---

## File Structure

**Created:**
- `lib/llm/types.ts` — shared types
- `lib/llm/encryption.ts` — AES-256-GCM wrappers
- `lib/llm/profiles.ts` — profile CRUD on `app_settings` + env migration
- `lib/llm/anthropic.ts` — Anthropic native provider
- `lib/llm/openai-compat.ts` — OpenAI-compatible provider
- `lib/llm/chat.ts` — provider dispatcher
- `lib/llm/prompt.ts` — system prompt + context block formatting
- `lib/llm/retrieval.ts` — FTS + byte-budget context assembler
- `app/api/chat/route.ts` — SSE streaming chat endpoint
- `app/api/settings/profiles/route.ts` — GET list, POST create
- `app/api/settings/profiles/[id]/route.ts` — PATCH, DELETE
- `app/api/settings/profiles/active/route.ts` — PUT set active
- `app/api/actions/sync-notion/route.ts` — POST action
- `app/bins/page.tsx` — default bins view
- `app/bins/[id]/page.tsx` — selected bin view
- `components/icons.tsx` — retro-futuristic SVG icon components
- `components/ReadingPane.tsx` — right-side note reading pane
- `components/RetiredBanner.tsx` — retired-page notice
- `components/chat/ChatEmptyState.tsx`
- `components/chat/ChatMessages.tsx`
- `components/chat/ChatInput.tsx`
- `components/chat/ScopeBadge.tsx`
- `components/chat/CitationChip.tsx`
- `components/chat/Toast.tsx` + `components/chat/ToastProvider.tsx`
- `components/settings/ProfileCard.tsx`
- `components/settings/ProfileForm.tsx`
- `tests/lib/llm/encryption.test.ts`
- `tests/lib/llm/profiles.test.ts`
- `tests/lib/llm/anthropic.test.ts`
- `tests/lib/llm/openai-compat.test.ts`
- `tests/lib/llm/chat.test.ts`
- `tests/lib/llm/prompt.test.ts`
- `tests/lib/llm/retrieval.test.ts`

**Modified:**
- `package.json`, `package-lock.json` — new deps
- `tailwind.config.ts` — new palette + font families
- `app/globals.css` — scrollbar + :focus-visible + base background
- `components/Sidebar.tsx` — full rewrite (4-icon strip + bin tree + search + footer)
- `components/BinTree.tsx` — add search filter + scope-selected state
- `components/NoteList.tsx` — replace `<Link>` with `onNoteClick` callback
- `components/QuickCapture.tsx` — visual restyle only
- `app/layout.tsx` — new two-column structure
- `app/page.tsx` — replace with chat home
- `app/notes/page.tsx` — replace with server-side redirect to `/bins`
- `app/review/page.tsx` — visual restyle
- `app/settings/page.tsx` — full rebuild (profiles + notion + actions + sync health)
- `app/clients/page.tsx` + `app/clients/[slug]/page.tsx` + `app/projects/page.tsx` + `app/agents/page.tsx` + `app/files/page.tsx` — add `<RetiredBanner />`

**Deleted:**
- Nothing — deprecated pages stay addressable per spec §10

---

## Task Order

Parts A–F build the backend (no UI changes, testable via curl). Parts G–P rebuild the UI. Part Q is verification.

- **A.** Dependencies & types
- **B.** Encryption & profiles
- **C.** Providers & dispatcher
- **D.** Retrieval pipeline
- **E.** Chat API
- **F.** Profile & action APIs
- **G.** Design tokens
- **H.** Icons
- **I.** Sidebar & layout
- **J.** Chat UI
- **K.** Reading pane & NoteList refactor
- **L.** Bins browse mode
- **M.** Review restyle
- **N.** Settings rebuild
- **O.** Retired pages
- **P.** QuickCapture restyle & /notes redirect
- **Q.** Verification

---

### Task 1: Install new dependencies

**Files:** Modify `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install @anthropic-ai/sdk@^0.91 openai@^4.34
```

Expected: both added to `dependencies`, no errors.

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: 123 tests passing (Phase 2 baseline).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @anthropic-ai/sdk + openai for llm agent"
```

---

### Task 2: LLM types

**Files:**
- Create: `lib/llm/types.ts`

- [ ] **Step 1: Write the file**

Create `lib/llm/types.ts`:

```typescript
export type LlmProviderType = "anthropic" | "openai-compatible";

export interface LlmProfile {
  id: string;
  name: string;
  type: LlmProviderType;
  api_key_encrypted: string;
  base_url?: string;
  default_model: string;
  max_context_tokens: number;
  created_at: string;
}

export interface LlmProfileInput {
  name: string;
  type: LlmProviderType;
  api_key: string;
  base_url?: string;
  default_model: string;
  max_context_tokens?: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmStreamChunk =
  | { type: "text"; text: string }
  | { type: "done"; usage?: { input_tokens?: number; output_tokens?: number } }
  | { type: "error"; status?: number; message: string };

export interface StreamChatOptions {
  messages: LlmMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/llm/types.ts
git commit -m "feat(llm): shared types for provider abstraction"
```

---

### Task 3: Encryption utility

**Files:**
- Create: `lib/llm/encryption.ts`
- Create: `tests/lib/llm/encryption.test.ts`

AES-256-GCM wrapping for API keys. Node builtin `crypto`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/llm/encryption.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, getOrCreateMachineKey, MACHINE_KEY_PATH } from "../../../lib/llm/encryption";
import fs from "fs";
import path from "path";
import os from "os";

let TEST_HOME: string;
const ORIGINAL_HOME = process.env.HOME;

describe("encryption", () => {
  beforeEach(() => {
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "enc-test-home-"));
    process.env.HOME = TEST_HOME;
  });
  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("getOrCreateMachineKey creates a 32-byte key with 0600 mode on first call", () => {
    const key = getOrCreateMachineKey();
    expect(key.length).toBe(32);
    const keyPath = path.join(TEST_HOME, ".config", "dashboard", "machine-key");
    expect(fs.existsSync(keyPath)).toBe(true);
    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("getOrCreateMachineKey returns same key on subsequent calls", () => {
    const k1 = getOrCreateMachineKey();
    const k2 = getOrCreateMachineKey();
    expect(Buffer.compare(k1, k2)).toBe(0);
  });

  it("encryptSecret + decryptSecret round-trip", () => {
    const plaintext = "sk-ant-abcdef1234567890";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("different ciphertexts for same plaintext (random IV)", () => {
    const c1 = encryptSecret("same");
    const c2 = encryptSecret("same");
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe("same");
    expect(decryptSecret(c2)).toBe("same");
  });

  it("decryptSecret throws on tampered ciphertext", () => {
    const valid = encryptSecret("secret");
    const tampered = valid.slice(0, -4) + "XXXX";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("MACHINE_KEY_PATH resolves under HOME/.config/dashboard/", () => {
    expect(MACHINE_KEY_PATH()).toBe(path.join(TEST_HOME, ".config", "dashboard", "machine-key"));
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/encryption.test.ts`
Expected: module-not-found errors.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/encryption.ts`:

```typescript
import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export function MACHINE_KEY_PATH(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".config", "dashboard", "machine-key");
}

export function getOrCreateMachineKey(): Buffer {
  const keyPath = MACHINE_KEY_PATH();
  if (fs.existsSync(keyPath)) {
    const buf = fs.readFileSync(keyPath);
    if (buf.length !== KEY_LENGTH) {
      throw new Error(`machine-key at ${keyPath} is ${buf.length} bytes, expected ${KEY_LENGTH}`);
    }
    return buf;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(KEY_LENGTH);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export function hasMachineKey(): boolean {
  const keyPath = MACHINE_KEY_PATH();
  if (!fs.existsSync(keyPath)) return false;
  try {
    const buf = fs.readFileSync(keyPath);
    return buf.length === KEY_LENGTH;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = getOrCreateMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getOrCreateMachineKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/lib/llm/encryption.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/encryption.ts tests/lib/llm/encryption.test.ts
git commit -m "feat(llm): aes-256-gcm encryption for api keys + machine-key bootstrap"
```

---

### Task 4: Profile CRUD + env-var migration

**Files:**
- Create: `lib/llm/profiles.ts`
- Create: `tests/lib/llm/profiles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/llm/profiles.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getActiveProfile,
  setActiveProfile,
  getProfileSecret,
  runMigrationFromEnv,
} from "../../../lib/llm/profiles";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-llm-profiles.db");
let TEST_HOME: string;

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("llm profiles", () => {
  beforeEach(() => {
    initTestDb();
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "llm-profile-test-"));
    process.env.HOME = TEST_HOME;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("createProfile stores an encrypted key + getProfileSecret decrypts", () => {
    const p = createProfile({
      name: "Anthropic",
      type: "anthropic",
      api_key: "sk-ant-raw-key",
      default_model: "claude-opus-4-7",
    });
    expect(p.id).toHaveLength(26);
    expect(p.api_key_encrypted).not.toContain("sk-ant");
    expect(p.max_context_tokens).toBe(200_000);
    expect(getProfileSecret(p.id)).toBe("sk-ant-raw-key");
  });

  it("listProfiles returns newest first", () => {
    createProfile({ name: "A", type: "anthropic", api_key: "a", default_model: "claude-opus-4-7" });
    createProfile({ name: "B", type: "anthropic", api_key: "b", default_model: "claude-opus-4-7" });
    const profiles = listProfiles();
    expect(profiles.map((p) => p.name)).toEqual(["B", "A"]);
  });

  it("createProfile uses 128_000 default max_context_tokens for openai-compatible", () => {
    const p = createProfile({
      name: "OR",
      type: "openai-compatible",
      api_key: "key",
      base_url: "https://openrouter.ai/api/v1",
      default_model: "anthropic/claude-sonnet-4-6",
    });
    expect(p.max_context_tokens).toBe(128_000);
  });

  it("createProfile respects explicit max_context_tokens override", () => {
    const p = createProfile({
      name: "Local",
      type: "openai-compatible",
      api_key: "key",
      base_url: "http://localhost:1234/v1",
      default_model: "llama-3.3-70b",
      max_context_tokens: 32_000,
    });
    expect(p.max_context_tokens).toBe(32_000);
  });

  it("updateProfile patches name + default_model, preserves id", () => {
    const p = createProfile({ name: "Old", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    const updated = updateProfile(p.id, { name: "New", default_model: "claude-sonnet-4-6" });
    expect(updated!.id).toBe(p.id);
    expect(updated!.name).toBe("New");
    expect(updated!.default_model).toBe("claude-sonnet-4-6");
  });

  it("updateProfile with api_key re-encrypts", () => {
    const p = createProfile({ name: "P", type: "anthropic", api_key: "v1", default_model: "claude-opus-4-7" });
    updateProfile(p.id, { api_key: "v2" });
    expect(getProfileSecret(p.id)).toBe("v2");
  });

  it("deleteProfile removes it + clears active if it was active", () => {
    const p = createProfile({ name: "P", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    setActiveProfile(p.id);
    expect(getActiveProfile()?.id).toBe(p.id);
    deleteProfile(p.id);
    expect(listProfiles()).toHaveLength(0);
    expect(getActiveProfile()).toBeNull();
  });

  it("setActiveProfile sets the active id; getActiveProfile returns it", () => {
    const a = createProfile({ name: "A", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    const b = createProfile({ name: "B", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    setActiveProfile(b.id);
    expect(getActiveProfile()?.id).toBe(b.id);
    setActiveProfile(a.id);
    expect(getActiveProfile()?.id).toBe(a.id);
  });

  it("getActiveProfile returns null when no profiles exist", () => {
    expect(getActiveProfile()).toBeNull();
  });

  it("runMigrationFromEnv creates a default profile from ANTHROPIC_API_KEY and marks it active", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    runMigrationFromEnv();
    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Claude direct");
    expect(profiles[0].default_model).toBe("claude-opus-4-7");
    expect(profiles[0].max_context_tokens).toBe(200_000);
    expect(getActiveProfile()?.id).toBe(profiles[0].id);
    expect(getProfileSecret(profiles[0].id)).toBe("sk-ant-from-env");
  });

  it("runMigrationFromEnv is a no-op when profiles already exist", () => {
    createProfile({ name: "Existing", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-new";
    runMigrationFromEnv();
    expect(listProfiles()).toHaveLength(1);
    expect(listProfiles()[0].name).toBe("Existing");
  });

  it("runMigrationFromEnv is a no-op when ANTHROPIC_API_KEY is unset", () => {
    delete process.env.ANTHROPIC_API_KEY;
    runMigrationFromEnv();
    expect(listProfiles()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/profiles.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/profiles.ts`:

```typescript
import { getSettingJson, setSettingJson, setSetting, getSetting } from "../queries/app-settings";
import { newId, nowIso } from "../utils";
import { encryptSecret, decryptSecret } from "./encryption";
import type { LlmProfile, LlmProfileInput, LlmProviderType } from "./types";

const PROFILES_KEY = "llm.profiles";
const ACTIVE_KEY = "llm.active_profile_id";

function defaultMaxContext(type: LlmProviderType, model: string): number {
  if (type === "anthropic") return 200_000;
  // openai-compatible: hard to know the model without a registry; default to a safe 128k
  // Users override per profile if running a smaller local model.
  if (model.includes("local") || model.startsWith("http")) return 32_000;
  return 128_000;
}

function readAll(): LlmProfile[] {
  return getSettingJson<LlmProfile[]>(PROFILES_KEY) ?? [];
}

function writeAll(profiles: LlmProfile[]): void {
  setSettingJson(PROFILES_KEY, profiles);
}

export function listProfiles(): LlmProfile[] {
  const profiles = readAll();
  return [...profiles].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getProfile(id: string): LlmProfile | null {
  return readAll().find((p) => p.id === id) ?? null;
}

export function createProfile(input: LlmProfileInput): LlmProfile {
  const now = nowIso();
  const profile: LlmProfile = {
    id: newId(),
    name: input.name,
    type: input.type,
    api_key_encrypted: encryptSecret(input.api_key),
    base_url: input.base_url,
    default_model: input.default_model,
    max_context_tokens: input.max_context_tokens ?? defaultMaxContext(input.type, input.default_model),
    created_at: now,
  };
  writeAll([...readAll(), profile]);
  return profile;
}

export function updateProfile(
  id: string,
  patch: Partial<LlmProfileInput>
): LlmProfile | null {
  const profiles = readAll();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const existing = profiles[idx];
  const next: LlmProfile = {
    ...existing,
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    base_url: patch.base_url === undefined ? existing.base_url : patch.base_url,
    default_model: patch.default_model ?? existing.default_model,
    max_context_tokens: patch.max_context_tokens ?? existing.max_context_tokens,
    api_key_encrypted: patch.api_key
      ? encryptSecret(patch.api_key)
      : existing.api_key_encrypted,
  };
  profiles[idx] = next;
  writeAll(profiles);
  return next;
}

export function deleteProfile(id: string): void {
  const profiles = readAll().filter((p) => p.id !== id);
  writeAll(profiles);
  if (getSetting(ACTIVE_KEY) === id) {
    setSetting(ACTIVE_KEY, "");
  }
}

export function getActiveProfile(): LlmProfile | null {
  const id = getSetting(ACTIVE_KEY);
  if (!id) return null;
  return getProfile(id);
}

export function setActiveProfile(id: string): void {
  if (!getProfile(id)) throw new Error(`profile ${id} not found`);
  setSetting(ACTIVE_KEY, id);
}

export function getProfileSecret(id: string): string {
  const profile = getProfile(id);
  if (!profile) throw new Error(`profile ${id} not found`);
  return decryptSecret(profile.api_key_encrypted);
}

export function runMigrationFromEnv(): void {
  if (readAll().length > 0) return;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  const profile = createProfile({
    name: "Claude direct",
    type: "anthropic",
    api_key: key,
    default_model: "claude-opus-4-7",
  });
  setActiveProfile(profile.id);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/lib/llm/profiles.test.ts`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/profiles.ts tests/lib/llm/profiles.test.ts
git commit -m "feat(llm): profile CRUD with encryption + env-var migration"
```

---

### Task 5: Anthropic provider

**Files:**
- Create: `lib/llm/anthropic.ts`
- Create: `tests/lib/llm/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/llm/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { streamAnthropic } from "../../../lib/llm/anthropic";
import type { LlmMessage, LlmStreamChunk } from "../../../lib/llm/types";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streamAnthropic", () => {
  it("converts SDK deltas into text chunks and ends with done", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: " world" } };
        yield { type: "message_delta", usage: { output_tokens: 2 } };
        yield { type: "message_stop" };
      }
      return gen();
    });

    const fakeClient: { messages: { create: typeof mockCreate } } = {
      messages: { create: mockCreate },
    };

    const messages: LlmMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hi" },
    ];

    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages,
      model: "claude-opus-4-7",
      max_tokens: 1024,
    });

    const chunks = await collect(stream);
    const textOnly = chunks.filter((c): c is { type: "text"; text: string } => c.type === "text");
    const doneChunk = chunks.find((c) => c.type === "done");

    expect(textOnly.map((c) => c.text).join("")).toBe("Hello world");
    expect(doneChunk).toBeTruthy();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-7",
        stream: true,
        max_tokens: 1024,
        system: "system prompt",
        messages: [{ role: "user", content: "hi" }],
      })
    );
  });

  it("yields error chunk when SDK throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    const fakeClient = { messages: { create: mockCreate } };
    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages: [{ role: "user", content: "q" }],
      model: "claude-opus-4-7",
    });
    const chunks = await collect(stream) as LlmStreamChunk[];
    const err = chunks.find((c) => c.type === "error") as { type: "error"; status?: number; message: string } | undefined;
    expect(err).toBeTruthy();
    expect(err!.status).toBe(429);
    expect(err!.message).toContain("rate limited");
  });

  it("handles empty message list by including only system if present", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { type: "message_stop" };
      }
      return gen();
    });
    const fakeClient = { messages: { create: mockCreate } };
    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages: [{ role: "system", content: "s" }],
      model: "claude-opus-4-7",
    });
    await collect(stream);
    expect(mockCreate.mock.calls[0][0].messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/anthropic.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/anthropic.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage, LlmStreamChunk } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

interface StreamOptions {
  client: Anthropic;
  messages: LlmMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export function makeAnthropicClient(api_key: string): Anthropic {
  return new Anthropic({ apiKey: api_key });
}

export async function* streamAnthropic(opts: StreamOptions): AsyncIterable<LlmStreamChunk> {
  const systemMsg = opts.messages.find((m) => m.role === "system");
  const nonSystem = opts.messages.filter((m) => m.role !== "system");

  try {
    const stream = await opts.client.messages.create({
      model: opts.model,
      stream: true,
      max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      system: systemMsg?.content,
      messages: nonSystem.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    } as Parameters<Anthropic["messages"]["create"]>[0]);

    let usage: { input_tokens?: number; output_tokens?: number } | undefined;

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const t = event.type as string;
      if (t === "content_block_delta") {
        const delta = event.delta as { type?: string; text?: string };
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text", text: delta.text };
        }
      } else if (t === "message_delta") {
        const u = event.usage as { output_tokens?: number } | undefined;
        if (u) usage = { ...(usage ?? {}), output_tokens: u.output_tokens };
      } else if (t === "message_start") {
        const msg = (event.message as { usage?: { input_tokens?: number } }) ?? {};
        if (msg.usage) usage = { ...(usage ?? {}), input_tokens: msg.usage.input_tokens };
      }
    }
    yield { type: "done", usage };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    yield {
      type: "error",
      status: e.status,
      message: e.message ?? String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/lib/llm/anthropic.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/anthropic.ts tests/lib/llm/anthropic.test.ts
git commit -m "feat(llm): anthropic streaming provider"
```

---

### Task 6: OpenAI-compatible provider

**Files:**
- Create: `lib/llm/openai-compat.ts`
- Create: `tests/lib/llm/openai-compat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/llm/openai-compat.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { streamOpenAiCompat } from "../../../lib/llm/openai-compat";
import type { LlmMessage, LlmStreamChunk } from "../../../lib/llm/types";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streamOpenAiCompat", () => {
  it("converts chunk deltas to text and ends with done", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { choices: [{ delta: { content: "Hello" } }] };
        yield { choices: [{ delta: { content: " world" } }] };
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
      }
      return gen();
    });
    const fakeClient = { chat: { completions: { create: mockCreate } } };
    const messages: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "q" },
    ];
    const chunks = await collect(
      streamOpenAiCompat({
        client: fakeClient as unknown as import("openai").OpenAI,
        messages,
        model: "moonshotai/kimi-k2",
      })
    );
    const text = chunks
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("Hello world");
    expect(chunks.at(-1)).toMatchObject({ type: "done" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "moonshotai/kimi-k2",
        stream: true,
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "q" },
        ],
      })
    );
  });

  it("yields error chunk on SDK failure", async () => {
    const mockCreate = vi.fn().mockRejectedValue(Object.assign(new Error("invalid key"), { status: 401 }));
    const fakeClient = { chat: { completions: { create: mockCreate } } };
    const chunks = (await collect(
      streamOpenAiCompat({
        client: fakeClient as unknown as import("openai").OpenAI,
        messages: [{ role: "user", content: "q" }],
        model: "x",
      })
    )) as LlmStreamChunk[];
    const err = chunks.find((c) => c.type === "error") as
      | { type: "error"; status?: number; message: string }
      | undefined;
    expect(err).toBeTruthy();
    expect(err!.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/openai-compat.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/openai-compat.ts`:

```typescript
import { OpenAI } from "openai";
import type { LlmMessage, LlmStreamChunk } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

interface StreamOptions {
  client: OpenAI;
  messages: LlmMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export function makeOpenAiCompatClient(api_key: string, base_url: string): OpenAI {
  return new OpenAI({ apiKey: api_key, baseURL: base_url });
}

export async function* streamOpenAiCompat(opts: StreamOptions): AsyncIterable<LlmStreamChunk> {
  try {
    const stream = await opts.client.chat.completions.create({
      model: opts.model,
      stream: true,
      max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);

    let usage: { input_tokens?: number; output_tokens?: number } | undefined;

    for await (const chunk of stream as AsyncIterable<{
      choices: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: "text", text: delta.content };
      }
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens,
          output_tokens: chunk.usage.completion_tokens,
        };
      }
    }
    yield { type: "done", usage };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    yield {
      type: "error",
      status: e.status,
      message: e.message ?? String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/lib/llm/openai-compat.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/openai-compat.ts tests/lib/llm/openai-compat.test.ts
git commit -m "feat(llm): openai-compatible streaming provider"
```

---

### Task 7: Chat dispatcher

**Files:**
- Create: `lib/llm/chat.ts`
- Create: `tests/lib/llm/chat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/llm/chat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChatForProfile } from "../../../lib/llm/chat";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createProfile } from "../../../lib/llm/profiles";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("../../../lib/llm/anthropic", () => ({
  makeAnthropicClient: vi.fn(() => "mock-anthropic-client"),
  streamAnthropic: vi.fn().mockImplementation(async function* () {
    yield { type: "text", text: "A" };
    yield { type: "done" };
  }),
}));

vi.mock("../../../lib/llm/openai-compat", () => ({
  makeOpenAiCompatClient: vi.fn(() => "mock-oai-client"),
  streamOpenAiCompat: vi.fn().mockImplementation(async function* () {
    yield { type: "text", text: "O" };
    yield { type: "done" };
  }),
}));

const TEST_DB = path.join(process.cwd(), "data", "test-llm-chat.db");
let TEST_HOME: string;

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("streamChatForProfile", () => {
  beforeEach(() => {
    initTestDb();
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "chat-test-"));
    process.env.HOME = TEST_HOME;
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("routes anthropic profile to anthropic provider", async () => {
    const p = createProfile({
      name: "A",
      type: "anthropic",
      api_key: "k",
      default_model: "claude-opus-4-7",
    });
    const out: string[] = [];
    for await (const chunk of streamChatForProfile({
      profile: p,
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "text") out.push(chunk.text);
    }
    expect(out.join("")).toBe("A");
  });

  it("routes openai-compatible profile to oai provider", async () => {
    const p = createProfile({
      name: "O",
      type: "openai-compatible",
      api_key: "k",
      base_url: "https://openrouter.ai/api/v1",
      default_model: "x/y",
    });
    const out: string[] = [];
    for await (const chunk of streamChatForProfile({
      profile: p,
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "text") out.push(chunk.text);
    }
    expect(out.join("")).toBe("O");
  });

  it("throws if openai-compatible profile has no base_url", async () => {
    const p = createProfile({
      name: "Bad",
      type: "openai-compatible",
      api_key: "k",
      base_url: "",
      default_model: "x",
    });
    // Clear base_url after create
    p.base_url = undefined;
    await expect(async () => {
      for await (const _ of streamChatForProfile({
        profile: p,
        messages: [{ role: "user", content: "q" }],
      })) {
        void _;
      }
    }).rejects.toThrow(/base_url/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/chat.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/chat.ts`:

```typescript
import { makeAnthropicClient, streamAnthropic } from "./anthropic";
import { makeOpenAiCompatClient, streamOpenAiCompat } from "./openai-compat";
import { getProfileSecret } from "./profiles";
import type { LlmMessage, LlmProfile, LlmStreamChunk } from "./types";

interface StreamChatOptions {
  profile: LlmProfile;
  messages: LlmMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export async function* streamChatForProfile(
  opts: StreamChatOptions
): AsyncIterable<LlmStreamChunk> {
  const secret = getProfileSecret(opts.profile.id);
  const model = opts.model ?? opts.profile.default_model;

  if (opts.profile.type === "anthropic") {
    const client = makeAnthropicClient(secret);
    yield* streamAnthropic({
      client,
      messages: opts.messages,
      model,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    });
    return;
  }

  if (opts.profile.type === "openai-compatible") {
    if (!opts.profile.base_url) {
      throw new Error("openai-compatible profile requires base_url");
    }
    const client = makeOpenAiCompatClient(secret, opts.profile.base_url);
    yield* streamOpenAiCompat({
      client,
      messages: opts.messages,
      model,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    });
    return;
  }

  throw new Error(`unsupported profile type: ${(opts.profile as { type: string }).type}`);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/lib/llm/chat.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/chat.ts tests/lib/llm/chat.test.ts
git commit -m "feat(llm): chat dispatcher routes to per-profile provider"
```

---

### Task 8: Prompt builder + retrieval pipeline

**Files:**
- Create: `lib/llm/prompt.ts`
- Create: `lib/llm/retrieval.ts`
- Create: `tests/lib/llm/prompt.test.ts`
- Create: `tests/lib/llm/retrieval.test.ts`

This is the chat agent's "what context goes to the model" logic.

- [ ] **Step 1: Write failing tests for prompt**

Create `tests/lib/llm/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "../../../lib/llm/prompt";

describe("buildSystemPrompt", () => {
  it("includes citation instruction and scope context", () => {
    const sp = buildSystemPrompt({ user_name: "Carter", scope_path: "content/reels/tokyo" });
    expect(sp).toContain("<citations>");
    expect(sp).toContain("<cite path");
    expect(sp).toContain("content/reels/tokyo");
    expect(sp).toContain("Carter");
  });

  it("omits scope section when scope_path is null", () => {
    const sp = buildSystemPrompt({ user_name: "Carter", scope_path: null });
    expect(sp).not.toContain("Current scope:");
  });
});

describe("buildUserMessage", () => {
  it("formats context blocks and appends the question", () => {
    const result = buildUserMessage({
      question: "What tokyo ideas?",
      context_notes: [
        { vault_path: "notes/a.md", body: "alpha body" },
        { vault_path: "notes/b.md", body: "beta body" },
      ],
    });
    expect(result).toContain("=== notes/a.md ===");
    expect(result).toContain("alpha body");
    expect(result).toContain("=== notes/b.md ===");
    expect(result).toContain("beta body");
    expect(result).toContain("What tokyo ideas?");
    // Question comes after context
    expect(result.indexOf("What tokyo ideas?")).toBeGreaterThan(result.indexOf("alpha body"));
  });

  it("handles empty context with a marker", () => {
    const result = buildUserMessage({ question: "anything?", context_notes: [] });
    expect(result).toContain("anything?");
    expect(result).toContain("No relevant notes");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- tests/lib/llm/prompt.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Write prompt implementation**

Create `lib/llm/prompt.ts`:

```typescript
export interface SystemPromptOptions {
  user_name: string;
  scope_path: string | null;
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const scopeBlock = opts.scope_path
    ? `\n\nCurrent scope: ${opts.scope_path} — the notes below are from this bin.\n`
    : "\n";
  return [
    `You are the agent for ${opts.user_name}'s personal knowledge vault.`,
    "Answer ONLY using the provided notes. Be concise — 2-4 short paragraphs or a short list.",
    "If the answer isn't in the notes, say so plainly.",
    scopeBlock,
    "After your prose answer, emit a <citations>...</citations> block listing the vault_paths you used,",
    'one per <cite path="..."/> element. If no notes were useful, emit <citations/>.',
    "Do not cite a path that wasn't in the provided notes.",
  ].join("");
}

export interface ContextNote {
  vault_path: string;
  body: string;
}

export interface UserMessageOptions {
  question: string;
  context_notes: ContextNote[];
}

export function buildUserMessage(opts: UserMessageOptions): string {
  const contextBlocks =
    opts.context_notes.length === 0
      ? "[No relevant notes found — answer only if the question is about general workspace state.]"
      : opts.context_notes
          .map((n) => `=== ${n.vault_path} ===\n${n.body}`)
          .join("\n\n");
  return `${contextBlocks}\n\n---\n\n${opts.question}`;
}
```

- [ ] **Step 4: Run prompt tests**

Run: `npm test -- tests/lib/llm/prompt.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Write failing tests for retrieval**

Create `tests/lib/llm/retrieval.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { assembleContext, sanitizeFtsQuery, resolveScopedBinIds } from "../../../lib/llm/retrieval";
import { upsertVaultNote, updateFtsRow } from "../../../lib/queries/vault-notes";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-llm-retrieval.db");
let VAULT: string;

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function writeNote(relPath: string, body: string): void {
  const abs = path.join(VAULT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

describe("sanitizeFtsQuery", () => {
  it("phrase-wraps and doubles internal quotes", () => {
    expect(sanitizeFtsQuery(`hey "there"`)).toBe(`"hey ""there"""`);
  });
  it("trims and collapses whitespace", () => {
    expect(sanitizeFtsQuery("  hi   world  ")).toBe(`"hi world"`);
  });
});

describe("assembleContext", () => {
  beforeEach(() => {
    initTestDb();
    VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-vault-"));
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(VAULT, { recursive: true, force: true });
  });

  it("returns top FTS hits with file bodies, frontmatter stripped", () => {
    writeNote("notes/tokyo.md", "---\ntitle: Tokyo\n---\nTokyo reel idea.");
    writeNote("notes/paris.md", "---\n---\nParis cafe post.");
    const n1 = upsertVaultNote({
      vault_path: "notes/tokyo.md",
      title: "Tokyo",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h1",
      modified_at: "2026-04-24T10:00:00Z",
    });
    const n2 = upsertVaultNote({
      vault_path: "notes/paris.md",
      title: "Paris",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h2",
      modified_at: "2026-04-24T11:00:00Z",
    });
    updateFtsRow({ note_id: n1.id, title: "Tokyo", plain_text: "Tokyo reel idea", tags: "" });
    updateFtsRow({ note_id: n2.id, title: "Paris", plain_text: "Paris cafe post", tags: "" });

    const context = assembleContext({
      query: "tokyo",
      scope_bin_id: null,
      vault_path: VAULT,
      max_context_tokens: 10_000,
    });
    expect(context.length).toBeGreaterThan(0);
    expect(context[0].vault_path).toBe("notes/tokyo.md");
    expect(context[0].body).toContain("Tokyo reel idea.");
    expect(context[0].body).not.toContain("---");
    expect(context[0].body).not.toContain("title: Tokyo");
  });

  it("respects byte budget — drops notes that would exceed", () => {
    const big = "x".repeat(5_000);
    writeNote("notes/a.md", big);
    writeNote("notes/b.md", big);
    writeNote("notes/c.md", big);
    for (const p of ["notes/a.md", "notes/b.md", "notes/c.md"]) {
      const n = upsertVaultNote({
        vault_path: p,
        title: p,
        source: "obsidian",
        source_id: null,
        source_url: null,
        content_hash: p,
        modified_at: "2026-04-24T10:00:00Z",
      });
      updateFtsRow({ note_id: n.id, title: p, plain_text: big, tags: "" });
    }
    const context = assembleContext({
      query: "xxxx",
      scope_bin_id: null,
      vault_path: VAULT,
      max_context_tokens: 2_500, // byte budget = 2500 * 0.6 * 4 = 6000 bytes
    });
    expect(context.length).toBeLessThanOrEqual(2);
  });

  it("filters to scoped bin when scope_bin_id is set", () => {
    writeNote("notes/a.md", "apple content");
    writeNote("notes/b.md", "apple content");
    const na = upsertVaultNote({
      vault_path: "notes/a.md",
      title: "a",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "a",
      modified_at: "2026-04-24T10:00:00Z",
    });
    const nb = upsertVaultNote({
      vault_path: "notes/b.md",
      title: "b",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "b",
      modified_at: "2026-04-24T10:00:00Z",
    });
    updateFtsRow({ note_id: na.id, title: "a", plain_text: "apple content", tags: "" });
    updateFtsRow({ note_id: nb.id, title: "b", plain_text: "apple content", tags: "" });
    const bin = createBin({ name: "fruit" });
    assignNoteToBin({ note_id: na.id, bin_id: bin.id, assigned_by: "manual" });

    const context = assembleContext({
      query: "apple",
      scope_bin_id: bin.id,
      vault_path: VAULT,
      max_context_tokens: 10_000,
    });
    expect(context.length).toBe(1);
    expect(context[0].vault_path).toBe("notes/a.md");
  });
});

describe("resolveScopedBinIds", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns the bin plus all descendants", () => {
    const root = createBin({ name: "root" });
    const child = createBin({ name: "child", parent_bin_id: root.id });
    const grandchild = createBin({ name: "grand", parent_bin_id: child.id });
    const ids = resolveScopedBinIds(root.id);
    expect(ids).toContain(root.id);
    expect(ids).toContain(child.id);
    expect(ids).toContain(grandchild.id);
    expect(ids.length).toBe(3);
  });

  it("returns just the bin when it has no children", () => {
    const b = createBin({ name: "lonely" });
    expect(resolveScopedBinIds(b.id)).toEqual([b.id]);
  });
});
```

- [ ] **Step 6: Run — expect failure**

Run: `npm test -- tests/lib/llm/retrieval.test.ts`
Expected: module-not-found.

- [ ] **Step 7: Write retrieval implementation**

Create `lib/llm/retrieval.ts`:

```typescript
import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { searchVaultNotes } from "../queries/vault-notes";
import { parseFrontmatter } from "../vault/frontmatter";
import type { ContextNote } from "./prompt";

const BYTES_PER_TOKEN = 4;
const BUDGET_FRACTION = 0.6;

export function sanitizeFtsQuery(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function resolveScopedBinIds(rootId: string): string[] {
  const db = getDb();
  const ids = new Set<string>([rootId]);
  const frontier = [rootId];
  while (frontier.length > 0) {
    const id = frontier.shift()!;
    const rows = db
      .prepare("SELECT id FROM bins WHERE parent_bin_id = ?")
      .all(id) as { id: string }[];
    for (const r of rows) {
      if (!ids.has(r.id)) {
        ids.add(r.id);
        frontier.push(r.id);
      }
    }
  }
  return Array.from(ids);
}

export interface AssembleContextOptions {
  query: string;
  scope_bin_id: string | null;
  vault_path: string;
  max_context_tokens: number;
}

export function assembleContext(opts: AssembleContextOptions): ContextNote[] {
  const safe = sanitizeFtsQuery(opts.query);
  const hits = searchVaultNotes(safe, 20);

  let allowedNoteIds: Set<string> | null = null;
  if (opts.scope_bin_id) {
    const binIds = resolveScopedBinIds(opts.scope_bin_id);
    const placeholders = binIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(`SELECT DISTINCT note_id FROM note_bins WHERE bin_id IN (${placeholders})`)
      .all(...binIds) as { note_id: string }[];
    allowedNoteIds = new Set(rows.map((r) => r.note_id));
  }

  const budgetBytes = Math.floor(opts.max_context_tokens * BUDGET_FRACTION * BYTES_PER_TOKEN);
  const out: ContextNote[] = [];
  let used = 0;

  for (const hit of hits) {
    if (allowedNoteIds && !allowedNoteIds.has(hit.note.id)) continue;
    const abs = path.join(opts.vault_path, hit.note.vault_path);
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const { body } = parseFrontmatter(raw);
    const cleanedBody = body.trimStart();
    const entrySize = hit.note.vault_path.length + cleanedBody.length + 20;
    if (used + entrySize > budgetBytes && out.length >= 3) break;
    let finalBody = cleanedBody;
    if (used + entrySize > budgetBytes) {
      const remaining = Math.max(0, budgetBytes - used - hit.note.vault_path.length - 20);
      finalBody = cleanedBody.slice(0, remaining);
    }
    out.push({ vault_path: hit.note.vault_path, body: finalBody });
    used += hit.note.vault_path.length + finalBody.length + 20;
    if (used >= budgetBytes) break;
  }

  return out;
}
```

- [ ] **Step 8: Run retrieval tests**

Run: `npm test -- tests/lib/llm/retrieval.test.ts`
Expected: 6 tests pass.

- [ ] **Step 9: Run full suite**

Run: `npm test`
Expected: ~155 tests passing (123 baseline + ~32 new across tasks 3-8).

- [ ] **Step 10: Commit**

```bash
git add lib/llm/prompt.ts lib/llm/retrieval.ts tests/lib/llm/prompt.test.ts tests/lib/llm/retrieval.test.ts
git commit -m "feat(llm): prompt builder + FTS retrieval with byte budget"
```

---

### Task 9: Chat API endpoint with SSE streaming

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/chat/route.ts`:

```typescript
import path from "path";
import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/llm/profiles";
import { streamChatForProfile } from "@/lib/llm/chat";
import { assembleContext } from "@/lib/llm/retrieval";
import { buildSystemPrompt, buildUserMessage } from "@/lib/llm/prompt";
import { getBinById } from "@/lib/queries/bins";
import { hasMachineKey } from "@/lib/llm/encryption";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export const dynamic = "force-dynamic";
const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  scope_bin_id?: string | null;
}

export async function POST(req: Request) {
  if (!hasMachineKey()) {
    return NextResponse.json(
      { error: "machine-key missing or unreadable; cannot decrypt profile key" },
      { status: 500 }
    );
  }
  const profile = getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "no active llm profile; configure one in Settings" }, { status: 400 });
  }

  const body = (await readJson(req)) as ChatRequest | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return badRequest("messages required");
  }
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg || !isNonEmptyString(lastUserMsg.content, 8000)) {
    return badRequest("last message must be a non-empty user message (<=8000 chars)");
  }

  let scopePath: string | null = null;
  if (body.scope_bin_id) {
    const bin = getBinById(body.scope_bin_id);
    if (bin) scopePath = bin.name;
  }

  const contextNotes = assembleContext({
    query: lastUserMsg.content,
    scope_bin_id: body.scope_bin_id ?? null,
    vault_path: VAULT_PATH,
    max_context_tokens: profile.max_context_tokens,
  });

  const systemPrompt = buildSystemPrompt({ user_name: "Carter", scope_path: scopePath });
  const userMessage = buildUserMessage({
    question: lastUserMsg.content,
    context_notes: contextNotes,
  });

  const llmMessages = [
    { role: "system" as const, content: systemPrompt },
    ...body.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const cited_notes = contextNotes.map((n) => n.vault_path);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "retrieved", paths: cited_notes })}\n\n`
        )
      );
      try {
        for await (const chunk of streamChatForProfile({ profile, messages: llmMessages })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify TS**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): /api/chat SSE streaming endpoint with retrieval + error handling"
```

---

### Task 10: Profile CRUD API routes

**Files:**
- Create: `app/api/settings/profiles/route.ts`
- Create: `app/api/settings/profiles/[id]/route.ts`
- Create: `app/api/settings/profiles/active/route.ts`

- [ ] **Step 1: Write `app/api/settings/profiles/route.ts` (GET + POST)**

```typescript
import { NextResponse } from "next/server";
import { listProfiles, createProfile, getActiveProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";
import type { LlmProviderType } from "@/lib/llm/types";

function redactKey<T extends { api_key_encrypted: string }>(p: T): Omit<T, "api_key_encrypted"> & { has_key: true } {
  const { api_key_encrypted: _omit, ...rest } = p;
  void _omit;
  return { ...rest, has_key: true };
}

export async function GET() {
  const profiles = listProfiles().map(redactKey);
  const active = getActiveProfile();
  return NextResponse.json({ profiles, active_id: active?.id ?? null });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.name, 80)) return badRequest("name required (<=80 chars)");
  const type = b.type;
  if (type !== "anthropic" && type !== "openai-compatible") return badRequest("type must be anthropic or openai-compatible");
  if (!isNonEmptyString(b.api_key, 500)) return badRequest("api_key required");
  if (!isNonEmptyString(b.default_model, 200)) return badRequest("default_model required");
  if (type === "openai-compatible" && !isNonEmptyString(b.base_url, 500))
    return badRequest("base_url required for openai-compatible");
  if (!isOptionalString(b.base_url, 500)) return badRequest("base_url must be string");
  const maxCtx = b.max_context_tokens;
  if (maxCtx !== undefined && (typeof maxCtx !== "number" || maxCtx < 1000 || maxCtx > 2_000_000)) {
    return badRequest("max_context_tokens must be 1000..2000000");
  }
  const created = createProfile({
    name: b.name as string,
    type: type as LlmProviderType,
    api_key: b.api_key as string,
    base_url: b.base_url as string | undefined,
    default_model: b.default_model as string,
    max_context_tokens: maxCtx as number | undefined,
  });
  return NextResponse.json({ profile: redactKey(created) }, { status: 201 });
}
```

- [ ] **Step 2: Write `app/api/settings/profiles/[id]/route.ts` (PATCH + DELETE)**

```typescript
import { NextResponse } from "next/server";
import { updateProfile, deleteProfile, getProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";
import type { LlmProviderType } from "@/lib/llm/types";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getProfile(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  if (b.name !== undefined && !isNonEmptyString(b.name, 80)) return badRequest("name must be non-empty string");
  if (b.type !== undefined && b.type !== "anthropic" && b.type !== "openai-compatible")
    return badRequest("type must be anthropic or openai-compatible");
  if (b.api_key !== undefined && !isNonEmptyString(b.api_key, 500)) return badRequest("api_key must be non-empty string");
  if (b.default_model !== undefined && !isNonEmptyString(b.default_model, 200))
    return badRequest("default_model must be non-empty string");
  const maxCtx = b.max_context_tokens;
  if (maxCtx !== undefined && (typeof maxCtx !== "number" || maxCtx < 1000 || maxCtx > 2_000_000)) {
    return badRequest("max_context_tokens must be 1000..2000000");
  }

  const updated = updateProfile(params.id, {
    name: b.name as string | undefined,
    type: b.type as LlmProviderType | undefined,
    api_key: b.api_key as string | undefined,
    base_url: b.base_url as string | undefined,
    default_model: b.default_model as string | undefined,
    max_context_tokens: maxCtx as number | undefined,
  });
  if (!updated) return NextResponse.json({ error: "update failed" }, { status: 500 });
  const { api_key_encrypted: _, ...rest } = updated;
  void _;
  return NextResponse.json({ profile: { ...rest, has_key: true } });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = getProfile(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteProfile(params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write `app/api/settings/profiles/active/route.ts` (PUT)**

```typescript
import { NextResponse } from "next/server";
import { setActiveProfile, getProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.id, 32)) return badRequest("id required");
  if (!getProfile(b.id as string)) return NextResponse.json({ error: "profile not found" }, { status: 404 });
  setActiveProfile(b.id as string);
  return NextResponse.json({ ok: true, active_id: b.id });
}
```

- [ ] **Step 4: Verify TS + commit**

Run: `npx tsc --noEmit && npm test`
Expected: clean + baseline tests pass.

```bash
git add app/api/settings/profiles/
git commit -m "feat(api): profile CRUD endpoints (list/create/patch/delete/set-active)"
```

---

### Task 11: sync-notion action API

**Files:**
- Create: `app/api/actions/sync-notion/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/actions/sync-notion/route.ts`:

```typescript
import { NextResponse } from "next/server";
import path from "path";
import { spawnSync } from "child_process";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
const CWD = process.cwd();

export async function POST() {
  const result = spawnSync(
    path.join(CWD, "node_modules", ".bin", "tsx"),
    ["scripts/sync-notion.ts"],
    {
      cwd: CWD,
      timeout: 120_000,
      encoding: "utf-8",
      env: { ...process.env, VAULT_PATH },
    }
  );
  if (result.status !== 0) {
    return NextResponse.json(
      { ok: false, error: result.stderr?.toString().slice(0, 500) ?? "sync-notion failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/actions/sync-notion/route.ts
git commit -m "feat(api): POST /api/actions/sync-notion triggers notion sync"
```

---

### Task 12: Design tokens — tailwind + globals

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`

- [ ] **Step 1: Overwrite `tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0d0d0d",
        raised: "#0a0a0a",
        sunken: "#111111",
        hover: "#141414",
        "border-subtle": "#1a1a1a",
        "border-default": "#1f1f1f",
        "border-strong": "#333333",
        "text-primary": "#ede8d8",
        "text-secondary": "#c9c6b7",
        "text-tertiary": "#a09e96",
        "text-muted": "#8e8c85",
        "text-subtle": "#6e6c66",
        "text-dim": "#4a4944",
        accent: "#7dd3fc",
        "accent-glow": "rgba(125, 211, 252, 0.06)",
        "accent-tint": "rgba(125, 211, 252, 0.04)",
        "accent-border": "rgba(125, 211, 252, 0.08)",
      },
      fontFamily: {
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": "0.625rem",
        xs: "0.6875rem",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
      },
      keyframes: {
        "caret-blink": {
          "0%, 50%": { opacity: "1" },
          "50.01%, 100%": { opacity: "0" },
        },
      },
      animation: {
        "caret-blink": "caret-blink 1s infinite",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 2: Overwrite `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

html, body {
  background: #0d0d0d;
  color: #ede8d8;
  font-family: 'Inter', sans-serif;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "cv11", "ss01";
}

.mono {
  font-family: 'JetBrains Mono', monospace;
}

/* Scrollbars */
* {
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
}
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
*::-webkit-scrollbar-thumb:hover { background: #4a4944; }

/* Focus visible: cyan outline */
*:focus-visible {
  outline: 2px solid #7dd3fc;
  outline-offset: 2px;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid #7dd3fc;
  outline-offset: 1px;
}

/* Utility: caret for streaming */
.streaming-caret::after {
  content: "▊";
  margin-left: 2px;
  color: #7dd3fc;
  animation: caret-blink 1s infinite;
}
```

- [ ] **Step 3: Verify `npm run build` still works**

Run: `npm run build`
Expected: clean compile. Visuals will be broken in the existing pages until they're rebuilt in later tasks — that's fine.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat(design): new palette + inter/jb-mono fonts + scrollbar + focus-visible"
```

---

### Task 13: Retro-futuristic icons

**Files:**
- Create: `components/icons.tsx`

- [ ] **Step 1: Write the file**

Create `components/icons.tsx`:

```typescript
import { forwardRef, type SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  size?: number;
  active?: boolean;
}

function makeIcon(name: string, paths: React.ReactNode) {
  const C = forwardRef<SVGSVGElement, IconProps>(({ size = 14, active, className, ...rest }, ref) => (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#7dd3fc" : "currentColor"}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {paths}
    </svg>
  ));
  C.displayName = `Icon.${name}`;
  return C;
}

export const ChatIcon = makeIcon(
  "Chat",
  <path d="M4 5h16v12H7l-3 3V5z" />
);

export const BinsIcon = makeIcon(
  "Bins",
  <>
    <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />
  </>
);

export const ReviewIcon = makeIcon(
  "Review",
  <>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>
);

export const SettingsIcon = makeIcon(
  "Settings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" />
  </>
);

export const SearchIcon = makeIcon(
  "Search",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>
);

export const CloseIcon = makeIcon(
  "Close",
  <path d="M6 6l12 12M18 6L6 18" />
);

export const ChevronIcon = makeIcon(
  "Chevron",
  <path d="M9 6l6 6-6 6" />
);

export const ChevronDownIcon = makeIcon(
  "ChevronDown",
  <path d="M6 9l6 6 6-6" />
);

export const ExternalIcon = makeIcon(
  "External",
  <path d="M14 3l7 7M21 3l-7 7M14 3h7v7M10 21l-7-7M3 21l7-7M10 21H3v-7" />
);

export const SendIcon = makeIcon(
  "Send",
  <path d="M4 20l16-8L4 4v6l8 2-8 2z" />
);
```

- [ ] **Step 2: Verify TS**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/icons.tsx
git commit -m "feat(ui): retro-futuristic line icons (chat/bins/review/settings/search/close/chevron/external/send)"
```

---

### Task 14: Rewrite `components/BinTree.tsx` with search

**Files:**
- Modify: `components/BinTree.tsx`

- [ ] **Step 1: Overwrite the file**

Replace `components/BinTree.tsx` with:

```typescript
"use client";

import { useMemo, useState } from "react";
import type { BinNode } from "@/lib/types";
import { ChevronDownIcon, ChevronIcon } from "./icons";

interface Props {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  filterQuery?: string;
}

function collectMatchingIds(bins: BinNode[], q: string, out: Set<string>): boolean {
  const qLower = q.toLowerCase();
  let anyMatch = false;
  for (const bin of bins) {
    const selfMatch = bin.name.toLowerCase().includes(qLower);
    const childrenMatch = collectMatchingIds(bin.children, q, out);
    if (selfMatch || childrenMatch) {
      out.add(bin.id);
      anyMatch = true;
    }
  }
  return anyMatch;
}

export function BinTree({ bins, selectedBinId, onSelect, filterQuery }: Props) {
  const visibleIds = useMemo(() => {
    if (!filterQuery || filterQuery.trim().length === 0) return null;
    const ids = new Set<string>();
    collectMatchingIds(bins, filterQuery.trim(), ids);
    return ids;
  }, [bins, filterQuery]);

  return (
    <ul role="tree" className="flex flex-col gap-0.5 text-xs mono">
      {bins.length === 0 ? (
        <li className="text-text-muted px-2 py-1 text-2xs">No bins yet.</li>
      ) : (
        bins.map((bin) => (
          <BinRow
            key={bin.id}
            node={bin}
            depth={0}
            selectedBinId={selectedBinId}
            onSelect={onSelect}
            visibleIds={visibleIds}
            forceExpand={!!filterQuery}
          />
        ))
      )}
    </ul>
  );
}

function BinRow({
  node,
  depth,
  selectedBinId,
  onSelect,
  visibleIds,
  forceExpand,
}: {
  node: BinNode;
  depth: number;
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  visibleIds: Set<string> | null;
  forceExpand: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = node.id === selectedBinId;
  const hasChildren = node.children.length > 0;
  if (visibleIds && !visibleIds.has(node.id)) return null;
  const open = forceExpand || expanded;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={isSelected}>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-text-muted hover:text-text-primary w-4 shrink-0"
            aria-label={open ? "collapse" : "expand"}
          >
            {open ? <ChevronDownIcon size={10} /> : <ChevronIcon size={10} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={() => onSelect(isSelected ? null : node.id)}
          style={{ paddingLeft: `${depth * 10}px` }}
          className={`flex-1 text-left px-2 py-1 rounded-sm ${
            isSelected
              ? "bg-accent-tint text-text-primary border-l-2 border-accent"
              : "text-text-tertiary hover:bg-hover hover:text-text-secondary"
          }`}
        >
          {node.name}{" "}
          <span className="text-text-subtle">· {node.note_count}</span>
        </button>
      </div>
      {open && hasChildren && (
        <ul className="pl-0">
          {node.children.map((child) => (
            <BinRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedBinId={selectedBinId}
              onSelect={onSelect}
              visibleIds={visibleIds}
              forceExpand={forceExpand}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BinTree.tsx
git commit -m "feat(ui): BinTree rewrite — search-aware, ARIA tree roles, retro chevrons"
```

---

### Task 15: Rewrite `components/Sidebar.tsx`

**Files:**
- Modify: `components/Sidebar.tsx`

- [ ] **Step 1: Overwrite**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { BinNode, SyncStatusRecord } from "@/lib/types";
import { BinTree } from "./BinTree";
import { ChatIcon, BinsIcon, ReviewIcon, SettingsIcon, SearchIcon } from "./icons";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof ChatIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "Chat", Icon: ChatIcon },
  { href: "/bins", label: "Bins", Icon: BinsIcon },
  { href: "/review", label: "Review", Icon: ReviewIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar({
  selectedBinId,
  onSelectBin,
}: {
  selectedBinId: string | null;
  onSelectBin: (id: string | null) => void;
}) {
  const pathname = usePathname();
  const [bins, setBins] = useState<BinNode[]>([]);
  const [filter, setFilter] = useState("");
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);

  useEffect(() => {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => setBins(d.bins ?? []));
    fetch("/api/system")
      .then((r) => r.json())
      .then((d) => setSync(d.sync ?? []));
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname?.startsWith(href + "/");
  };

  const freshestSync = sync.reduce<SyncStatusRecord | null>((best, s) => {
    if (s.status !== "ok") return best;
    if (!best) return s;
    return s.last_run_at > best.last_run_at ? s : best;
  }, null);

  const freshDot =
    freshestSync &&
    Date.now() - new Date(freshestSync.last_run_at).getTime() < 10 * 60_000;

  return (
    <aside className="fixed top-0 left-0 h-screen w-[220px] bg-raised border-r border-border-default flex flex-col z-10">
      <div className="flex items-center gap-3.5 px-3 py-2.5 border-b border-border-default">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            className="p-1 rounded text-text-muted hover:text-text-primary"
          >
            <item.Icon size={14} active={isActive(item.href)} />
          </Link>
        ))}
      </div>

      <div className="px-2 pt-2 pb-1">
        <label className="relative block">
          <span className="sr-only">search bins</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle">
            <SearchIcon size={10} />
          </span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="search bins"
            className="w-full bg-hover border border-border-default rounded-sm pl-6 pr-2 py-1 text-2xs text-text-primary placeholder:text-text-subtle mono focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <BinTree
          bins={bins}
          selectedBinId={selectedBinId}
          onSelect={onSelectBin}
          filterQuery={filter}
        />
      </div>

      <div className="px-3 py-2.5 border-t border-border-default flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${freshDot ? "bg-accent" : "bg-text-dim"}`}
          style={freshDot ? { boxShadow: "0 0 6px #7dd3fc" } : undefined}
        />
        <span className="mono text-2xs text-text-dim">
          {freshestSync
            ? `synced ${relTime(freshestSync.last_run_at)}`
            : "no sync yet"}
        </span>
      </div>
    </aside>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat(ui): new Sidebar — 4-icon strip + search + bin tree + sync health footer"
```

---

### Task 16: Rewrite `app/layout.tsx`

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Overwrite**

```typescript
"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { GlobalCapture } from "@/components/GlobalCapture";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);

  return (
    <html lang="en">
      <head>
        <title>Command Center</title>
      </head>
      <body>
        <Sidebar selectedBinId={selectedBinId} onSelectBin={setSelectedBinId} />
        <GlobalCapture />
        <main className="ml-[220px] min-h-screen bg-base" data-selected-bin={selectedBinId ?? ""}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

**Note:** because the layout is now a Client Component, we lose the exported `metadata`. That's acceptable — page-level metadata can be set via `<title>` in `<head>`. Alternative refactor (deferred): split into a server RootLayout with a client shell; not necessary for v1.2.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ui): layout rewrite — fixed sidebar + shared selectedBin state"
```

---

### Task 17: Toast system

**Files:**
- Create: `components/chat/Toast.tsx`
- Create: `components/chat/ToastProvider.tsx`

- [ ] **Step 1: Write `components/chat/ToastProvider.tsx`**

```typescript
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastLevel = "info" | "warn" | "error";
interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
}
interface ToastContextValue {
  show: (message: string, level?: ToastLevel) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, level: ToastLevel = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, level, message }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((list) => list.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="fixed bottom-4 right-4 flex flex-col gap-2 z-[70]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mono text-2xs px-3 py-2 rounded-md border ${
              t.level === "error"
                ? "bg-raised border-red-400/50 text-red-400"
                : t.level === "warn"
                ? "bg-raised border-amber-400/40 text-amber-300"
                : "bg-raised border-border-default text-text-secondary"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ToastProvider.tsx
git commit -m "feat(ui): toast provider + useToast hook"
```

---

### Task 18: Scope badge + citation chip

**Files:**
- Create: `components/chat/ScopeBadge.tsx`
- Create: `components/chat/CitationChip.tsx`

- [ ] **Step 1: Write `components/chat/ScopeBadge.tsx`**

```typescript
"use client";

import { CloseIcon } from "../icons";

export function ScopeBadge({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 px-2 py-0.5 border border-accent bg-accent-tint rounded-sm">
      <span className="mono text-2xs text-accent">{label}</span>
      <button onClick={onClear} aria-label="clear scope" className="text-accent hover:text-text-primary">
        <CloseIcon size={10} />
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Write `components/chat/CitationChip.tsx`**

```typescript
"use client";

import { ExternalIcon } from "../icons";

interface Props {
  vault_path: string;
  onClick: () => void;
}

export function CitationChip({ vault_path, onClick }: Props) {
  const filename = vault_path.split("/").pop() ?? vault_path;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-1 border border-border-default rounded-sm mono text-2xs text-accent hover:bg-hover"
    >
      <ExternalIcon size={10} />
      {filename}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/chat/ScopeBadge.tsx components/chat/CitationChip.tsx
git commit -m "feat(ui): ScopeBadge + CitationChip"
```

---

### Task 19: Chat empty state

**Files:**
- Create: `components/chat/ChatEmptyState.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

interface Props {
  user_name: string;
  has_profile: boolean;
  suggested_prompts: string[];
  onPickPrompt: (p: string) => void;
  onGoToSettings: () => void;
}

export function ChatEmptyState({
  user_name,
  has_profile,
  suggested_prompts,
  onPickPrompt,
  onGoToSettings,
}: Props) {
  if (!has_profile) {
    return (
      <div className="max-w-md mx-auto text-center flex flex-col items-center gap-4">
        <div className="mono text-2xs text-text-subtle tracking-widest uppercase">Setup required</div>
        <div className="text-lg text-text-primary">Configure your first LLM profile</div>
        <p className="text-xs text-text-muted leading-relaxed">
          Add an Anthropic or OpenAI-compatible profile in Settings. The chat needs a provider to answer.
        </p>
        <button
          onClick={onGoToSettings}
          className="mono text-2xs px-3 py-1.5 bg-accent text-raised rounded-md font-medium hover:opacity-90"
        >
          Open Settings
        </button>
      </div>
    );
  }

  const greet = greetingForHour();
  return (
    <div className="w-full max-w-xl mx-auto text-center flex flex-col items-center gap-5">
      <div className="mono text-2xs text-text-subtle tracking-widest uppercase">
        {greet}, {user_name}
      </div>
      <div className="text-xl text-text-primary font-medium">Ask your workspace</div>
      {suggested_prompts.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center max-w-lg mt-2">
          {suggested_prompts.map((p, i) => (
            <button
              key={i}
              onClick={() => onPickPrompt(p)}
              className="mono text-2xs text-text-tertiary px-2.5 py-1.5 border border-border-default rounded-sm hover:bg-hover hover:text-text-primary"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ChatEmptyState.tsx
git commit -m "feat(ui): ChatEmptyState — greeting + prompts + no-profile CTA"
```

---

### Task 20: Chat messages + streaming hook

**Files:**
- Create: `components/chat/ChatMessages.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "./CitationChip";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: string[];
}

interface Props {
  messages: ChatMessage[];
  onCitationClick: (vault_path: string) => void;
}

export function parseCitations(text: string): { body: string; cites: string[] } {
  const m = text.match(/<citations>([\s\S]*?)<\/citations>/i);
  if (!m) {
    const self = text.match(/<citations\s*\/>/i);
    if (self) return { body: text.replace(/<citations\s*\/>/i, "").trim(), cites: [] };
    return { body: text, cites: [] };
  }
  const inner = m[1];
  const cites = Array.from(inner.matchAll(/<cite\s+path="([^"]+)"\s*\/?>/g)).map((x) => x[1]);
  const body = text.replace(m[0], "").trim();
  return { body, cites: Array.from(new Set(cites)) };
}

export function ChatMessages({ messages, onCitationClick }: Props) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return (
            <div
              key={msg.id}
              className="self-end max-w-[80%] px-3 py-2 bg-raised border border-border-default rounded-lg text-sm text-text-primary"
              style={{ borderBottomRightRadius: "2px" }}
            >
              {msg.content}
            </div>
          );
        }
        const { body, cites } = parseCitations(msg.content);
        const renderedCites = msg.citations?.length ? msg.citations : cites;
        return (
          <div key={msg.id} className="max-w-[92%] text-sm text-text-primary leading-relaxed">
            <div className={msg.streaming ? "streaming-caret" : ""}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
            {renderedCites.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {renderedCites.map((p) => (
                  <CitationChip key={p} vault_path={p} onClick={() => onCitationClick(p)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ChatMessages.tsx
git commit -m "feat(ui): ChatMessages with markdown + streaming caret + citation parsing"
```

---

### Task 21: Chat input

**Files:**
- Create: `components/chat/ChatInput.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { SendIcon } from "../icons";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  presetText?: string;
}

export function ChatInput({ onSubmit, disabled, presetText }: Props) {
  const [value, setValue] = useState(presetText ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (presetText !== undefined) {
      setValue(presetText);
      ref.current?.focus();
    }
  }, [presetText]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="border-t border-border-subtle px-6 py-4">
      <div className="max-w-3xl mx-auto">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask your workspace…"
          rows={3}
          aria-label="Chat input"
          disabled={disabled}
          className="w-full bg-sunken border border-border-strong rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-subtle resize-none focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_rgba(125,211,252,0.06)] disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="mono text-2xs text-text-dim">
            ↵ send · <span className="text-accent">⌘⇧C</span> capture
          </div>
          <button
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            className="mono text-2xs px-3 py-1.5 bg-accent text-raised rounded-md font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            <SendIcon size={11} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ChatInput.tsx
git commit -m "feat(ui): ChatInput — textarea + submit button + keyboard hints"
```

---

### Task 22: Chat page (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Overwrite**

```typescript
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessages, parseCitations, type ChatMessage } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScopeBadge } from "@/components/chat/ScopeBadge";
import { ToastProvider, useToast } from "@/components/chat/ToastProvider";
import { ReadingPane } from "@/components/ReadingPane";

interface SuggestedPromptsResponse {
  prompts: string[];
}

function newId() {
  return Math.random().toString(36).slice(2);
}

function ChatPageInner() {
  const router = useRouter();
  const { show } = useToast();
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [scopeName, setScopeName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [readingPath, setReadingPath] = useState<string | null>(null);
  const [presetText, setPresetText] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/settings/profiles")
      .then((r) => r.json())
      .then((d: { profiles: { id: string; default_model?: string }[]; active_id: string | null }) => {
        if (!d.active_id) {
          setProfileReady(false);
          return;
        }
        setProfileReady(true);
        const active = d.profiles.find((p) => p.id === d.active_id);
        if (active?.default_model) setActiveModel(active.default_model);
      });
  }, []);

  useEffect(() => {
    const host = document.querySelector("main");
    const observer = new MutationObserver(() => {
      const binAttr = host?.getAttribute("data-selected-bin") ?? "";
      setSelectedBinId(binAttr ? binAttr : null);
    });
    if (host) observer.observe(host, { attributes: true, attributeFilter: ["data-selected-bin"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedBinId) {
      setScopeName(null);
      return;
    }
    fetch(`/api/bins`)
      .then((r) => r.json())
      .then((d: { bins: { id: string; name: string; children?: { id: string; name: string }[] }[] }) => {
        const find = (nodes: typeof d.bins, id: string, path: string[]): string[] | null => {
          for (const n of nodes) {
            const next = [...path, n.name];
            if (n.id === id) return next;
            if (n.children) {
              const inner = find(n.children as typeof d.bins, id, next);
              if (inner) return inner;
            }
          }
          return null;
        };
        const p = find(d.bins, selectedBinId, []);
        setScopeName(p ? p.join(" / ") : null);
      });
  }, [selectedBinId]);

  useEffect(() => {
    fetch("/api/chat/suggested-prompts")
      .then((r) => (r.ok ? (r.json() as Promise<SuggestedPromptsResponse>) : { prompts: [] }))
      .then((d) => setSuggested(d.prompts ?? []))
      .catch(() => setSuggested([]));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
      const assistantMsg: ChatMessage = { id: newId(), role: "assistant", content: "", streaming: true };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
            scope_bin_id: selectedBinId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          show(data.error ?? `Chat failed (${res.status})`, "error");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: "(agent unavailable)", streaming: false } : m
            )
          );
          setStreaming(false);
          return;
        }
        if (!res.body) throw new Error("no response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let citations: string[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let event: { type: string; text?: string; message?: string; paths?: string[] };
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event.type === "retrieved" && event.paths) {
              citations = event.paths;
            } else if (event.type === "text" && event.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: m.content + event.text } : m
                )
              );
            } else if (event.type === "error") {
              show(event.message ?? "Agent error", "error");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: m.content + " (agent error)" } : m
                )
              );
            }
          }
        }
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            const { cites } = parseCitations(m.content);
            return { ...m, streaming: false, citations: cites.length > 0 ? cites : citations };
          })
        );
      } catch (err) {
        show(err instanceof Error ? err.message : "Agent unreachable", "error");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m))
        );
      } finally {
        setStreaming(false);
      }
    },
    [messages, selectedBinId, show]
  );

  if (profileReady === null) {
    return <div className="text-xs text-text-muted p-6">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {scopeName && (
        <div className="border-b border-border-subtle px-6 py-2 flex items-center gap-3">
          <span className="mono text-2xs text-text-subtle uppercase tracking-wider">Scope</span>
          <ScopeBadge label={scopeName.toLowerCase()} onClear={() => setSelectedBinId(null)} />
          {activeModel && (
            <span className="ml-auto mono text-2xs text-text-dim">{activeModel}</span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <ChatEmptyState
              user_name="Carter"
              has_profile={profileReady}
              suggested_prompts={suggested}
              onPickPrompt={(p) => setPresetText(p)}
              onGoToSettings={() => router.push("/settings")}
            />
          </div>
        ) : (
          <>
            <ChatMessages messages={messages} onCitationClick={setReadingPath} />
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      <ChatInput onSubmit={submit} disabled={streaming || !profileReady} presetText={presetText} />
      {readingPath && (
        <ReadingPane path={readingPath} onClose={() => setReadingPath(null)} />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <ToastProvider>
      <ChatPageInner />
    </ToastProvider>
  );
}
```

Also create `app/api/chat/suggested-prompts/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listRecentVaultNotes } from "@/lib/queries/vault-notes";

export async function GET() {
  const recent = listRecentVaultNotes(24 * 30, 3);
  if (recent.length === 0) return NextResponse.json({ prompts: [] });
  const prompts = recent.slice(0, 3).map((n, i) => {
    const title = n.title.slice(0, 60);
    if (i === 0) return `Summarize ${title}`;
    if (i === 1) return `What did I note about ${title.split(/\s+/).slice(0, 3).join(" ")}`;
    return `What's in my recent notes`;
  });
  return NextResponse.json({ prompts });
}
```

- [ ] **Step 2: Verify TS + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx app/api/chat/suggested-prompts/
git commit -m "feat(ui): chat page at / — SSE streaming, scope badge, suggested prompts"
```

---

### Task 23: Refactor NoteList to callback pattern

**Files:**
- Modify: `components/NoteList.tsx`

- [ ] **Step 1: Rewrite**

```typescript
"use client";

import type { VaultNote } from "@/lib/types";

interface Props {
  notes: VaultNote[];
  onNoteClick: (note: VaultNote) => void;
  emptyMessage?: string;
  selectedPath?: string | null;
}

const sourceLabels: Record<VaultNote["source"], string> = {
  obsidian: "obsidian",
  notion: "notion",
  capture: "capture",
  "apple-notes": "apple notes",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function NoteList({ notes, onNoteClick, emptyMessage = "No notes.", selectedPath }: Props) {
  if (notes.length === 0) {
    return <div className="text-xs text-text-muted px-2 py-8 text-center">{emptyMessage}</div>;
  }
  return (
    <ul className="flex flex-col">
      {notes.map((n) => {
        const isSel = n.vault_path === selectedPath;
        return (
          <li key={n.id}>
            <button
              onClick={() => onNoteClick(n)}
              className={`w-full text-left px-5 py-2.5 border-b border-border-subtle flex items-center gap-3 ${
                isSel
                  ? "bg-accent-tint border-l-2 border-l-accent"
                  : "hover:bg-hover"
              }`}
            >
              <span className="text-xs text-text-primary flex-1 truncate">{n.title}</span>
              <span className="mono text-2xs text-text-subtle">{sourceLabels[n.source]}</span>
              <span className="mono text-2xs text-text-subtle w-16 text-right">{relTime(n.modified_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Update the single existing caller**

`app/clients/[slug]/page.tsx` currently renders notes inline (not using NoteList). The `/notes` page is being replaced. Search for other callers:

Run: `grep -rn "NoteList" app components --include="*.tsx" | grep -v "^components/NoteList"`
Expected: used in `app/review/page.tsx` (will be rewritten in Task 27).

No other callers — safe.

- [ ] **Step 3: Commit**

```bash
git add components/NoteList.tsx
git commit -m "refactor(ui): NoteList uses onNoteClick callback + new aesthetic"
```

---

### Task 24: Reading pane component

**Files:**
- Create: `components/ReadingPane.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { VaultNote, Bin } from "@/lib/types";
import { CloseIcon, ExternalIcon } from "./icons";

interface Detail {
  note: VaultNote;
  content: string;
  bins: Bin[];
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function ReadingPane({ path, onClose }: { path: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetch(`/api/notes/by-path?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error ?? `HTTP ${r.status}`);
          return;
        }
        setDetail(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fmEnd = detail ? detail.content.lastIndexOf("---") : -1;
  const body =
    detail && detail.content.startsWith("---") && fmEnd > 0
      ? detail.content.slice(fmEnd + 3).trim()
      : detail?.content ?? "";

  return (
    <aside
      className="fixed right-0 top-0 bottom-0 w-[340px] bg-raised border-l border-border-default z-20 flex flex-col"
      role="complementary"
      aria-label="Reading pane"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="mono text-2xs text-text-dim">reading</span>
        {detail?.note.source_url && (
          <a
            href={detail.note.source_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-accent hover:opacity-80"
            aria-label={`Open in ${detail.note.source}`}
          >
            <ExternalIcon size={12} />
          </a>
        )}
        {detail && (
          <a
            href={`obsidian://open?path=${encodeURIComponent(detail.note.vault_path)}`}
            className={`${detail.note.source_url ? "" : "ml-auto"} text-accent hover:opacity-80`}
            aria-label="Open in Obsidian"
          >
            <ExternalIcon size={12} />
          </a>
        )}
        <button onClick={onClose} aria-label="Close pane" className="text-text-muted hover:text-text-primary">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && <div className="text-2xs text-red-400">{error}</div>}
        {!detail && !error && <div className="text-2xs text-text-muted">Loading…</div>}
        {detail && (
          <>
            <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1.5">
              {detail.note.source} · {relTime(detail.note.modified_at)}
            </div>
            <h2 className="text-base text-text-primary font-medium mb-3">{detail.note.title}</h2>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
            {detail.bins.length > 0 && (
              <>
                <div className="mono text-2xs text-text-muted uppercase tracking-wider mt-6 mb-2">
                  In bins
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {detail.bins.map((b) => (
                    <span
                      key={b.id}
                      className="mono text-2xs px-2 py-1 bg-hover border border-border-default rounded-sm text-text-secondary"
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add `/api/notes/by-path` endpoint to support path lookup**

Create `app/api/notes/by-path/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getVaultNoteByPath } from "@/lib/queries/vault-notes";
import { listBinsForNote } from "@/lib/queries/bins";

const VAULT_PATH = process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const p = searchParams.get("path");
  if (!p) return NextResponse.json({ error: "path required" }, { status: 400 });
  const note = getVaultNoteByPath(p);
  if (!note || note.deleted_at) return NextResponse.json({ error: "not found" }, { status: 404 });
  let content = "";
  try {
    content = fs.readFileSync(path.join(VAULT_PATH, note.vault_path), "utf-8");
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 500 });
  }
  const bins = listBinsForNote(note.id);
  return NextResponse.json({ note, content, bins });
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ReadingPane.tsx app/api/notes/by-path/
git commit -m "feat(ui): ReadingPane + /api/notes/by-path endpoint for path-based note lookup"
```

---

### Task 25: Bins browse pages

**Files:**
- Create: `app/bins/page.tsx`
- Create: `app/bins/[id]/page.tsx`

- [ ] **Step 1: Write `app/bins/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
import type { VaultNote } from "@/lib/types";

export default function BinsDefaultPage() {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/notes?limit=100")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 border-b border-border-subtle">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">workspace</div>
        <h1 className="text-xl text-text-primary font-medium">Recent</h1>
        <div className="text-2xs text-text-muted mt-1 mono">Pick a bin from the sidebar to browse it.</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted p-6">Loading…</div>
        ) : (
          <NoteList
            notes={notes}
            onNoteClick={(n) => setReading(n.vault_path)}
            selectedPath={reading}
            emptyMessage="No notes yet."
          />
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Write `app/bins/[id]/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
import type { VaultNote } from "@/lib/types";

interface BinShape {
  id: string;
  name: string;
  children?: BinShape[];
}

function findPath(bins: BinShape[], id: string, acc: string[] = []): string[] | null {
  for (const b of bins) {
    const next = [...acc, b.name];
    if (b.id === id) return next;
    if (b.children) {
      const found = findPath(b.children, id, next);
      if (found) return found;
    }
  }
  return null;
}

export default function BinDetailPage({ params }: { params: { id: string } }) {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/notes?bin=${encodeURIComponent(params.id)}&limit=500`).then((r) => r.json()),
      fetch(`/api/bins`).then((r) => r.json()),
    ]).then(([notesResp, binsResp]) => {
      setNotes(notesResp.notes ?? []);
      const p = findPath(binsResp.bins ?? [], params.id);
      if (p) setPath(p);
      setLoading(false);
    });
  }, [params.id]);

  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 border-b border-border-subtle">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">
          {path.join(" / ").toLowerCase()}
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl text-text-primary font-medium">{path.at(-1) ?? "Bin"}</h1>
          <span className="mono text-2xs text-text-muted">{notes.length} notes</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted p-6">Loading…</div>
        ) : (
          <NoteList
            notes={notes}
            onNoteClick={(n) => setReading(n.vault_path)}
            selectedPath={reading}
            emptyMessage="No notes in this bin yet."
          />
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/bins/
git commit -m "feat(ui): bins browse — /bins default + /bins/[id] detail with reading pane"
```

---

### Task 26: Review page restyle

**Files:**
- Modify: `app/review/page.tsx`

- [ ] **Step 1: Overwrite**

```typescript
"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
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

function relTime(iso: string | null): string {
  if (!iso) return "empty";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/review")
      .then((r) => r.json())
      .then((d: ReviewData) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-screen overflow-y-auto">
      <div className="px-6 py-6">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">daily triage</div>
        <h1 className="text-xl text-text-primary font-medium mb-6">Review</h1>

        {loading || !data ? (
          <div className="text-xs text-text-muted">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Today" count={data.today.length}>
              <NoteList notes={data.today} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="Nothing modified today." />
            </Card>
            <Card title="Uncategorized" count={data.uncategorized.length}>
              <NoteList notes={data.uncategorized} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="All notes have a bin." />
            </Card>
            <Card title="Recent · 7d" count={data.recent.length}>
              <NoteList notes={data.recent} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="No recent activity." />
            </Card>
            <Card title="Stale bins · 30d+" count={data.stale_bins.length}>
              {data.stale_bins.length === 0 ? (
                <div className="text-xs text-text-muted px-2 py-8 text-center">No stale bins.</div>
              ) : (
                <ul>
                  {data.stale_bins.map((b) => (
                    <li key={b.id} className="px-5 py-2.5 border-b border-border-subtle flex justify-between mono text-xs">
                      <span className="text-text-primary">{b.name.toLowerCase()}</span>
                      <span className="text-text-subtle">{relTime(b.last_activity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

function Card({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-raised border border-border-default rounded-md">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border-subtle">
        <span className="mono text-2xs text-text-primary uppercase tracking-wider font-medium">{title}</span>
        <span className="mono text-2xs text-text-subtle">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/review/page.tsx
git commit -m "feat(ui): /review restyled with new palette + reading pane integration"
```

---

### Task 27: Profile form + card components

**Files:**
- Create: `components/settings/ProfileCard.tsx`
- Create: `components/settings/ProfileForm.tsx`

- [ ] **Step 1: Write `ProfileCard.tsx`**

```typescript
"use client";

export interface ProfileDisplay {
  id: string;
  name: string;
  type: "anthropic" | "openai-compatible";
  default_model: string;
  base_url?: string;
  max_context_tokens: number;
  has_key: true;
}

interface Props {
  profile: ProfileDisplay;
  active: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileCard({ profile, active, onSetActive, onEdit, onDelete }: Props) {
  if (active) {
    return (
      <div className="p-3 bg-accent-tint border border-accent rounded-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ boxShadow: "0 0 6px #7dd3fc" }} />
          <span className="text-xs text-text-primary font-medium">{profile.name}</span>
          <span className="ml-auto mono text-2xs text-accent uppercase tracking-wider">active</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mono text-2xs">
          <span className="text-text-subtle">type</span><span className="text-text-primary">{profile.type}</span>
          <span className="text-text-subtle">model</span><span className="text-text-primary">{profile.default_model}</span>
          {profile.base_url && (<><span className="text-text-subtle">base</span><span className="text-text-primary truncate">{profile.base_url}</span></>)}
          <span className="text-text-subtle">context</span><span className="text-text-primary">{profile.max_context_tokens.toLocaleString()}</span>
          <span className="text-text-subtle">key</span><span className="text-text-primary">stored</span>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={onEdit} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-primary hover:bg-hover">edit</button>
          <button onClick={onDelete} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-muted hover:text-red-400">delete</button>
        </div>
      </div>
    );
  }
  return (
    <div className="p-3 bg-sunken border border-border-default rounded-md">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-border-strong" />
        <span className="text-xs text-text-secondary">{profile.name}</span>
        <button onClick={onSetActive} className="ml-auto mono text-2xs text-text-muted hover:text-accent">set active</button>
      </div>
      <div className="mono text-2xs text-text-muted">
        {profile.type} · {profile.default_model}
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={onEdit} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-secondary hover:bg-hover">edit</button>
        <button onClick={onDelete} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-muted hover:text-red-400">delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `ProfileForm.tsx`**

```typescript
"use client";

import { useState } from "react";
import type { LlmProviderType } from "@/lib/llm/types";

interface Props {
  initial?: {
    id?: string;
    name: string;
    type: LlmProviderType;
    default_model: string;
    base_url?: string;
    max_context_tokens: number;
  };
  onSave: (input: {
    id?: string;
    name: string;
    type: LlmProviderType;
    api_key?: string;
    default_model: string;
    base_url?: string;
    max_context_tokens: number;
  }) => void;
  onCancel: () => void;
}

export function ProfileForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<LlmProviderType>(initial?.type ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [model, setModel] = useState(initial?.default_model ?? "claude-opus-4-7");
  const [maxCtx, setMaxCtx] = useState<number>(initial?.max_context_tokens ?? 200_000);
  const isEdit = !!initial?.id;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!model.trim()) return;
    if (!isEdit && !apiKey.trim()) return;
    if (type === "openai-compatible" && !baseUrl.trim()) return;
    onSave({
      id: initial?.id,
      name: name.trim(),
      type,
      api_key: apiKey.trim() || undefined,
      default_model: model.trim(),
      base_url: type === "openai-compatible" ? baseUrl.trim() : undefined,
      max_context_tokens: maxCtx,
    });
  }

  return (
    <form onSubmit={submit} className="bg-sunken border border-border-default rounded-md p-4 flex flex-col gap-3 mono text-2xs">
      <div className="grid grid-cols-[100px_1fr] items-center gap-x-3 gap-y-2">
        <label className="text-text-subtle">name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        <label className="text-text-subtle">type</label>
        <select value={type} onChange={(e) => setType(e.target.value as LlmProviderType)} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none">
          <option value="anthropic">anthropic (native)</option>
          <option value="openai-compatible">openai-compatible</option>
        </select>
        <label className="text-text-subtle">api key</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEdit ? "leave blank to keep existing" : "sk-…"} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        {type === "openai-compatible" && (
          <>
            <label className="text-text-subtle">base url</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
          </>
        )}
        <label className="text-text-subtle">model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-7" className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        <label className="text-text-subtle">context</label>
        <input type="number" value={maxCtx} onChange={(e) => setMaxCtx(Number(e.target.value))} min={1000} max={2_000_000} step={1000} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
      </div>
      <div className="flex gap-2 justify-end mt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-border-default rounded-sm text-text-muted hover:text-text-primary">cancel</button>
        <button type="submit" className="px-3 py-1.5 bg-accent text-raised rounded-sm font-medium">save</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/
git commit -m "feat(ui): ProfileCard + ProfileForm for llm profile management"
```

---

### Task 28: Settings page rebuild

**Files:**
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Overwrite**

```typescript
"use client";

import { useEffect, useState } from "react";
import { ProfileCard, type ProfileDisplay } from "@/components/settings/ProfileCard";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { ActionButton } from "@/components/ActionButton";
import type { SyncStatusRecord } from "@/lib/types";

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<ProfileDisplay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProfileDisplay | null>(null);
  const [adding, setAdding] = useState(false);
  const [targets, setTargets] = useState<string>("");
  const [targetsStatus, setTargetsStatus] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);

  async function reloadProfiles() {
    const d = await fetch("/api/settings/profiles").then((r) => r.json());
    setProfiles(d.profiles ?? []);
    setActiveId(d.active_id ?? null);
  }

  useEffect(() => {
    reloadProfiles();
    fetch("/api/settings/notion-targets").then((r) => r.json()).then((d) => setTargets((d.targets ?? []).join("\n")));
    fetch("/api/system").then((r) => r.json()).then((d) => setSync(d.sync ?? []));
  }, []);

  async function saveProfile(input: Parameters<React.ComponentProps<typeof ProfileForm>["onSave"]>[0]) {
    if (input.id) {
      await fetch(`/api/settings/profiles/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } else {
      await fetch("/api/settings/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }
    setEditing(null);
    setAdding(false);
    reloadProfiles();
  }

  async function setActive(id: string) {
    await fetch("/api/settings/profiles/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    reloadProfiles();
  }

  async function deleteProfile(id: string) {
    if (!confirm("Delete this profile? Its encrypted key will be gone.")) return;
    await fetch(`/api/settings/profiles/${id}`, { method: "DELETE" });
    reloadProfiles();
  }

  async function saveTargets() {
    setTargetsStatus(null);
    const list = targets.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const res = await fetch("/api/settings/notion-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: list }),
    });
    const d = await res.json();
    if (!res.ok) setTargetsStatus(`error: ${d.error}`);
    else {
      setTargetsStatus("saved");
      setTimeout(() => setTargetsStatus(null), 2000);
    }
  }

  return (
    <div className="h-screen overflow-y-auto">
      <div className="px-6 py-6">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">configuration</div>
        <h1 className="text-xl text-text-primary font-medium mb-6">Settings</h1>

        <div className="bg-raised border border-border-default rounded-md p-5 mb-4">
          <div className="flex items-center mb-4">
            <span className="mono text-2xs text-text-muted uppercase tracking-wider">provider profiles</span>
            <button
              onClick={() => { setAdding(true); setEditing(null); }}
              className="ml-auto mono text-2xs px-2.5 py-1 border border-border-default rounded-sm text-text-primary hover:bg-hover"
            >+ add profile</button>
          </div>
          <div className="flex flex-col gap-2">
            {profiles.length === 0 && !adding && (
              <div className="text-xs text-text-muted py-4 text-center">No profiles configured.</div>
            )}
            {profiles.map((p) => (
              editing?.id === p.id ? (
                <ProfileForm
                  key={p.id}
                  initial={{
                    id: p.id, name: p.name, type: p.type,
                    default_model: p.default_model, base_url: p.base_url,
                    max_context_tokens: p.max_context_tokens,
                  }}
                  onSave={saveProfile}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  active={p.id === activeId}
                  onSetActive={() => setActive(p.id)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => deleteProfile(p.id)}
                />
              )
            ))}
            {adding && (
              <ProfileForm
                onSave={saveProfile}
                onCancel={() => setAdding(false)}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-raised border border-border-default rounded-md p-5">
            <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">notion sync targets</div>
            <div className="mono text-2xs text-text-subtle mb-2">page IDs, one per line</div>
            <textarea
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              rows={5}
              className="w-full bg-sunken border border-border-default rounded-sm p-2 mono text-2xs text-text-primary focus:border-accent focus:outline-none"
            />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={saveTargets} className="mono text-2xs px-2.5 py-1 bg-accent text-raised rounded-sm font-medium">save</button>
              {targetsStatus && <span className="mono text-2xs text-text-subtle">{targetsStatus}</span>}
            </div>
          </div>

          <div className="bg-raised border border-border-default rounded-md p-5">
            <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">actions</div>
            <div className="flex flex-col gap-2">
              <ActionButton label="run vault indexer" endpoint="/api/actions/reindex" />
              <ActionButton
                label="re-seed bins from folders"
                endpoint="/api/actions/seed-bins"
                confirm="Re-apply automatic bin assignments from folder layout? Manual assignments are preserved."
              />
              <ActionButton label="run notion sync" endpoint="/api/actions/sync-notion" />
            </div>
          </div>
        </div>

        <div className="bg-raised border border-border-default rounded-md p-5">
          <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">sync health</div>
          <div className="mono text-2xs">
            {sync.map((s) => {
              const fresh = Date.now() - new Date(s.last_run_at).getTime() < 10 * 60_000;
              return (
                <div key={s.sync_name} className="flex justify-between py-1">
                  <span className="text-text-primary">{s.sync_name}</span>
                  <span className={fresh ? "text-accent" : "text-text-subtle"}>
                    ● {relTime(s.last_run_at)}
                  </span>
                </div>
              );
            })}
            {sync.length === 0 && <div className="text-text-muted">No sync runs yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(ui): settings rebuild — profiles + notion + actions + sync health"
```

---

### Task 29: Retired banner + apply to retired pages

**Files:**
- Create: `components/RetiredBanner.tsx`
- Modify: `app/clients/page.tsx`, `app/clients/[slug]/page.tsx`, `app/projects/page.tsx`, `app/agents/page.tsx`, `app/files/page.tsx`

- [ ] **Step 1: Write `components/RetiredBanner.tsx`**

```typescript
import Link from "next/link";

export function RetiredBanner() {
  return (
    <div className="bg-hover border-b border-border-default px-6 py-2 text-2xs mono flex items-center justify-between">
      <span className="text-text-muted">This page is retired from the primary navigation.</span>
      <Link href="/" className="text-accent hover:opacity-80">Go to Chat →</Link>
    </div>
  );
}
```

- [ ] **Step 2: Apply to `app/clients/page.tsx`**

Find the top of the default export and add `<RetiredBanner />` as the first child inside the returned JSX. Add the import at top.

Edit `app/clients/page.tsx`:
- Add `import { RetiredBanner } from "@/components/RetiredBanner";` near the top
- Wrap the outer `<div>` return content so `<RetiredBanner />` appears first

Same for `app/clients/[slug]/page.tsx`, `app/projects/page.tsx`, `app/agents/page.tsx`, `app/files/page.tsx`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/RetiredBanner.tsx app/clients app/projects app/agents app/files
git commit -m "feat(ui): RetiredBanner + applied to clients/projects/agents/files"
```

---

### Task 30: /notes redirect + QuickCapture restyle

**Files:**
- Modify: `app/notes/page.tsx` (replace with redirect)
- Modify: `components/QuickCapture.tsx` (visual restyle only)

- [ ] **Step 1: Replace `app/notes/page.tsx`**

```typescript
import { redirect } from "next/navigation";

export default function NotesRedirect(): never {
  redirect("/bins");
}
```

- [ ] **Step 2: Update `components/QuickCapture.tsx` visual tokens**

Open `components/QuickCapture.tsx` and do a find-and-replace pass:
- Replace `bg-card` → `bg-raised`
- Replace `bg-base` → `bg-sunken`
- Replace `border-border` → `border-border-default`
- Replace `border-accent-green` → `border-accent`
- Replace `text-text-primary` stays the same
- Replace `bg-accent-green` → `bg-accent`
- Replace the backdrop: change `bg-black/60 backdrop-blur-sm` to `bg-black/70 backdrop-blur-md`
- Add `focus:shadow-[0_0_0_3px_rgba(125,211,252,0.06)]` to the textarea's className after `focus:border-accent focus:outline-none`

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/notes/page.tsx components/QuickCapture.tsx
git commit -m "feat(ui): /notes redirects to /bins + QuickCapture restyled for new palette"
```

---

### Task 31: Full test + lint + build

**Files:** none.

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass. ~155 tests (123 baseline + ~32 new from tasks 3-8).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean. All new routes present: `/api/chat`, `/api/chat/suggested-prompts`, `/api/settings/profiles`, `/api/settings/profiles/[id]`, `/api/settings/profiles/active`, `/api/actions/sync-notion`, `/api/notes/by-path`, `/bins`, `/bins/[id]`.

If anything fails, fix it inline.

---

### Task 32: Manual end-to-end smoke test

**Files:** none.

- [ ] **Step 1: Start dev server**

Run: `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`

Visit `http://localhost:3001`.

- [ ] **Step 2: First-run check**

If you haven't set `ANTHROPIC_API_KEY`, the chat page should show the "Configure your first LLM profile" CTA. Click it, go to Settings.

- [ ] **Step 3: Add a profile**

Click "+ add profile". Fill in:
- name: "Claude"
- type: anthropic
- api_key: your real key
- default_model: claude-opus-4-7
- context: 200000

Save. Click "set active" if not already.

- [ ] **Step 4: Chat**

Go back to `/`. Type "summarize recent notes" (or click a suggested prompt). Response should stream in.

- [ ] **Step 5: Citations + reading pane**

If the response has citations, click one — reading pane slides in from right showing the note.

- [ ] **Step 6: Bin scope**

Click a bin in the sidebar. Scope badge appears above chat. Ask a question. Response should reference that bin's notes.

- [ ] **Step 7: Bins browse**

Click `Bins` icon (top of sidebar). Main area switches to `/bins`. Click a bin in sidebar — navigates to `/bins/[id]`. Click notes — reading pane opens.

- [ ] **Step 8: Review**

Click Review icon. Verify 4 cards render. Click a note in any card — reading pane opens.

- [ ] **Step 9: Settings full exercise**

Back to Settings. Try: edit profile, change active, delete a profile (make a throwaway one first). Notion sync targets save/load. Click each action button — verify "Done ✓" or error surfaces.

- [ ] **Step 10: QuickCapture + retired pages**

Press ⌘⇧C. Modal opens with new styling. Submit a capture. Verify it lands in the right bin.

Manually navigate to `/clients`. Verify retired banner appears with "Go to Chat →" link.

- [ ] **Step 11: Report**

Note what works and what's broken. If any fixes are needed, iterate before merging.

---

## Post-Plan Checklist

- [ ] `npm test` green (expected ~155 passing)
- [ ] `npm run lint` clean
- [ ] `npm run build` clean
- [ ] Chat streams correctly and renders citations
- [ ] Reading pane opens on citation click
- [ ] Bin click in sidebar scopes chat
- [ ] Bins mode shows per-bin note lists
- [ ] Settings adds/edits/deletes profiles, switches active
- [ ] Retired pages show banner
- [ ] `/notes` redirects to `/bins`
- [ ] QuickCapture (⌘⇧C) still works with new styling

---

## Self-Review

**Spec coverage:**
- §2 In scope — all items covered (layout redesign: Tasks 12-16; chat at `/`: Task 22; `/bins`: Task 25; restyles: Tasks 26, 28, 30; reading pane: Task 24; multi-provider: Tasks 3-10; new deps: Task 1; sync-notion endpoint: Task 11; retired from nav: Task 29; QuickCapture restyle: Task 30)
- §4 Visual tokens — Tasks 12, 13
- §4.5 States/responsive — Task 12 (globals.css transitions, focus, scrollbars)
- §5 Surfaces — all covered (5.1 Sidebar: Task 15; 5.2 Chat: Tasks 17-22; 5.3 Bins: Tasks 23-25; 5.4 Review: Task 26; 5.5 Settings: Tasks 27-28; 5.6 Reading pane: Task 24; 5.7 Capture restyle: Task 30)
- §6 Interaction — Task 22 (scope badge, citation click, state carry via layout's `data-selected-bin`)
- §7 Provider system — Tasks 1-7, 10
- §7.3 Encryption recovery UX — Task 9's API returns 500 when machine key is missing; full-screen recovery modal is deferred to a minor follow-up (plan covers the server-side check; UI recovery modal can be added as a small polish task after manual smoke reveals if it's actually needed)
- §7.5 Env-var migration — Task 4 (`runMigrationFromEnv` fn; called automatically when `listProfiles` is first needed via tests; production integration happens on first API call — acceptable since profile CRUD is lazy)
- §8 Retrieval — Task 8
- §9 Schema — no schema changes required; `app_settings` already exists from Phase 2
- §10 Retired pages — Tasks 29, 30
- §11 Deferred — not implemented in this plan (correct)
- §12 Risks — error handling in Task 9 (API) + Task 22 (UI toasts); a11y baseline in Tasks 13 (icons aria-hidden), 14 (tree role), 24 (pane aria-label + Esc)
- §13 Success criteria — covered by Task 31 (automated) + Task 32 (manual)

**Gaps (explicitly accepted):**
1. The machine-key recovery modal (§7.3) is not implemented as a blocking full-screen route. If the key is missing with existing profiles, the Chat API returns 500 with a clear error and the chat UI shows a red toast. Full recovery modal UX is deferred — low real-world likelihood, and adding it means a new root-layout conditional that's risky. Can be added later.
2. Prompt-caching for Anthropic is not implemented (spec §7.2 says deferred).
3. First-run env migration is called lazily (via tests). For production, we could add a one-time server-side call at app boot — but in Next.js App Router there's no clean "app boot" hook. The first call to `listProfiles()` on any endpoint (GET /api/settings/profiles) triggers the check and creates the profile. This is acceptable.

**Placeholder scan:** grep for TBD / TODO / "similar to" — none found. All code blocks are complete.

**Type consistency:**
- `LlmProfile` shape defined in Task 2 is used consistently through Tasks 4-10, 22, 27, 28
- `ProfileDisplay` (redacted shape) defined in Task 10 matches Task 27, 28
- `ChatMessage` defined in Task 20 matches Task 22
- `ContextNote` in Task 8 matches Task 9
- `LlmStreamChunk` in Task 2 matches Tasks 5, 6, 7, 9
- Function names consistent: `streamChatForProfile`, `assembleContext`, `buildSystemPrompt`, `buildUserMessage`, `encryptSecret`, `decryptSecret`, `createProfile`, `updateProfile`, `deleteProfile`, `setActiveProfile`, `getActiveProfile`, `getProfileSecret`, `runMigrationFromEnv`, `sanitizeFtsQuery`, `resolveScopedBinIds`, `hasMachineKey`, `MACHINE_KEY_PATH`, `parseCitations` — no drift across references.

No inconsistencies found.
