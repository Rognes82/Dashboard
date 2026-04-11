# Command Center Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified command center dashboard that visualizes client/project status, agent/automation health, files, and notes from a single SQLite-backed Next.js app, hosted on the Mac Mini via Tailscale LAN.

**Architecture:** Three layers — SQLite data layer populated by independent TypeScript sync scripts, Next.js API routes serving data, and a React/Tailwind UI with a collapsible sidebar and dark-mode design system. Each sync script is independent and upsert-safe.

**Tech Stack:** Next.js 14 (App Router) · TypeScript · better-sqlite3 · Tailwind CSS · Lucide React · JetBrains Mono + IBM Plex Sans · Vitest (tests)

---

## File Structure

```
Dashboard/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout (sidebar + main)
│   ├── page.tsx                   # Dashboard home
│   ├── globals.css                # Tailwind + fonts
│   ├── clients/
│   │   ├── page.tsx               # Clients list
│   │   └── [slug]/page.tsx        # Client hub
│   ├── agents/page.tsx            # Agents & system
│   ├── files/page.tsx             # Files browser
│   ├── notes/page.tsx             # Notes browser
│   ├── settings/page.tsx          # Settings
│   └── api/
│       ├── clients/route.ts
│       ├── clients/[slug]/route.ts
│       ├── system/route.ts
│       ├── files/route.ts
│       ├── notes/route.ts
│       └── activity/route.ts
├── components/
│   ├── Sidebar.tsx                # Collapsible nav
│   ├── StatCard.tsx
│   ├── ClientPipeline.tsx
│   ├── ActivityFeed.tsx
│   ├── SyncHealth.tsx
│   ├── StatusDot.tsx
│   ├── Badge.tsx
│   ├── Card.tsx
│   └── Breadcrumb.tsx
├── lib/
│   ├── db.ts                      # SQLite singleton
│   ├── schema.sql                 # Table definitions
│   ├── types.ts                   # Shared TS types
│   ├── utils.ts                   # ULID, date format helpers
│   └── queries/
│       ├── clients.ts
│       ├── projects.ts
│       ├── files.ts
│       ├── notes.ts
│       ├── agents.ts
│       ├── activity.ts
│       └── sync-status.ts
├── scripts/
│   ├── init-db.ts
│   ├── sync-projects.ts
│   ├── sync-cron.ts
│   └── sync-agents.ts
├── tests/
│   ├── lib/queries/*.test.ts
│   └── scripts/*.test.ts
├── data/                          # dashboard.db lives here (gitignored)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── vitest.config.ts
└── README.md
```

Each file has one clear responsibility. Query files are split per table so each stays small. Sync scripts are independent — if one breaks, the others keep working.

---

## Phase 1: Foundation

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `.gitignore` (update)

- [ ] **Step 1: Initialize package.json**

Run:
```bash
cd /Users/carterrognes/Work/Claude/Projects/Dashboard
npm init -y
```

- [ ] **Step 2: Install Next.js, React, TypeScript**

Run:
```bash
npm install next@14 react@18 react-dom@18
npm install -D typescript @types/react @types/react-dom @types/node
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

- [ ] **Step 5: Update `.gitignore`**

Append to existing `.gitignore`:
```
node_modules/
.next/
out/
data/*.db
data/*.db-journal
next-env.d.ts
*.log
```

- [ ] **Step 6: Add `dev` and `build` scripts**

Edit `package.json` scripts section:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "init-db": "tsx scripts/init-db.ts",
  "sync:projects": "tsx scripts/sync-projects.ts",
  "sync:cron": "tsx scripts/sync-cron.ts",
  "sync:agents": "tsx scripts/sync-agents.ts"
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.js .gitignore
git commit -m "chore: scaffold Next.js 14 project with TypeScript"
```

---

### Task 2: Set up Tailwind CSS with design system

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.js`, `app/globals.css`

- [ ] **Step 1: Install Tailwind**

```bash
npm install -D tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Create `postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0a0a0a",
        card: "#111111",
        hover: "#1a1a1a",
        border: "#222222",
        "text-primary": "#f5f5f5",
        "text-secondary": "#888888",
        "text-muted": "#555555",
        "accent-green": "#4ade80",
        "accent-amber": "#facc15",
        "accent-red": "#ef4444",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ['"IBM Plex Sans"', "sans-serif"],
      },
      fontSize: {
        "2xs": "0.625rem", // 10px
        xs: "0.6875rem",   // 11px
      },
      borderRadius: {
        card: "6px",
        badge: "4px",
      },
      transitionDuration: {
        "200": "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 4: Create `app/globals.css`**

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  background-color: #0a0a0a;
  color: #f5f5f5;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.mono {
  font-family: 'JetBrains Mono', monospace;
  font-variant-numeric: tabular-nums;
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts postcss.config.js app/globals.css package.json package-lock.json
git commit -m "feat: add Tailwind CSS with dark design system tokens"
```

---

### Task 3: Set up SQLite with better-sqlite3 and testing framework

**Files:**
- Create: `lib/db.ts`, `lib/schema.sql`, `scripts/init-db.ts`, `vitest.config.ts`, `data/.gitkeep`

- [ ] **Step 1: Install dependencies**

```bash
npm install better-sqlite3 ulid
npm install -D @types/better-sqlite3 tsx vitest
```

- [ ] **Step 2: Create `data/.gitkeep`**

```bash
mkdir -p data
touch data/.gitkeep
```

- [ ] **Step 3: Create `lib/schema.sql`**

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

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  title TEXT NOT NULL,
  content_preview TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  tags TEXT,
  modified_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
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
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);
CREATE INDEX IF NOT EXISTS idx_notes_client_id ON notes(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_client_id ON activity(client_id);
```

- [ ] **Step 4: Create `lib/db.ts`**

```ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let dbInstance: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;
  const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "dashboard.db");
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbInstance = new Database(resolvedPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbForTesting(dbPath: string): Database.Database {
  closeDb();
  return getDb(dbPath);
}
```

- [ ] **Step 5: Create `scripts/init-db.ts`**

```ts
import { getDb } from "../lib/db";
import fs from "fs";
import path from "path";

function initDb(): void {
  const db = getDb();
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  console.log("Database initialized at data/dashboard.db");
}

initDb();
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Run init-db and verify**

```bash
npm run init-db
ls data/
```
Expected: `dashboard.db` exists in `data/`.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/schema.sql scripts/init-db.ts vitest.config.ts data/.gitkeep package.json package-lock.json
git commit -m "feat: SQLite setup with schema and init script"
```

---

### Task 4: Create shared TypeScript types and utils

**Files:**
- Create: `lib/types.ts`, `lib/utils.ts`, `tests/lib/utils.test.ts`

- [ ] **Step 1: Create `lib/types.ts`**

```ts
export type ClientStatus = "active" | "paused" | "completed";
export type FileSource = "local" | "gdrive" | "notion";
export type NoteSource = "notion" | "apple_notes" | "obsidian";
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

export interface Note {
  id: string;
  client_id: string | null;
  title: string;
  content_preview: string | null;
  source: NoteSource;
  source_url: string | null;
  tags: string | null;
  modified_at: string | null;
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
}
```

- [ ] **Step 2: Write failing test for `lib/utils.ts`**

Create `tests/lib/utils.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newId, nowIso, slugify, formatRelativeTime } from "../../lib/utils";

describe("utils", () => {
  it("newId returns a 26-char ULID", () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("nowIso returns ISO 8601 string", () => {
    const now = nowIso();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("slugify lowercases and hyphenates", () => {
    expect(slugify("Akoola Media")).toBe("akoola-media");
    expect(slugify("  Synergy  Contracting!  ")).toBe("synergy-contracting");
  });

  it("formatRelativeTime returns 'just now' for <60s", () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("just now");
  });

  it("formatRelativeTime returns 'Xm ago' for minutes", () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(d.toISOString())).toBe("5m ago");
  });

  it("formatRelativeTime returns 'Xh ago' for hours", () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(d.toISOString())).toBe("3h ago");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/lib/utils.test.ts
```
Expected: FAIL with "Cannot find module '../../lib/utils'"

- [ ] **Step 4: Implement `lib/utils.ts`**

```ts
import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.floor(diffDay / 7);
  return `${diffWk}w ago`;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/lib/utils.test.ts
```
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/utils.ts tests/lib/utils.test.ts package.json package-lock.json
git commit -m "feat: shared types and utility functions with tests"
```

---

## Phase 2: Query Layer

### Task 5: Implement client queries with tests

**Files:**
- Create: `lib/queries/clients.ts`, `tests/lib/queries/clients.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/queries/clients.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createClient, listClients, getClientBySlug, updateClientStatus } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-clients.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("clients queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("createClient inserts and returns the client", () => {
    const client = createClient({ name: "Akoola", pipeline_stage: "scripts delivered" });
    expect(client.name).toBe("Akoola");
    expect(client.slug).toBe("akoola");
    expect(client.status).toBe("active");
    expect(client.id).toHaveLength(26);
  });

  it("listClients returns all clients ordered by name", () => {
    createClient({ name: "Zeta" });
    createClient({ name: "Alpha" });
    const clients = listClients();
    expect(clients).toHaveLength(2);
    expect(clients[0].name).toBe("Alpha");
  });

  it("getClientBySlug returns the matching client", () => {
    createClient({ name: "Akoola" });
    const client = getClientBySlug("akoola");
    expect(client?.name).toBe("Akoola");
  });

  it("getClientBySlug returns null for missing", () => {
    expect(getClientBySlug("nope")).toBeNull();
  });

  it("updateClientStatus changes status and pipeline_stage", () => {
    const client = createClient({ name: "Akoola" });
    const updated = updateClientStatus(client.id, "paused", "on hold");
    expect(updated?.status).toBe("paused");
    expect(updated?.pipeline_stage).toBe("on hold");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/lib/queries/clients.test.ts
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `lib/queries/clients.ts`**

```ts
import { getDb } from "../db";
import { newId, nowIso, slugify } from "../utils";
import type { Client, ClientStatus } from "../types";

export function createClient(input: {
  name: string;
  pipeline_stage?: string;
  notes?: string;
}): Client {
  const db = getDb();
  const id = newId();
  const slug = slugify(input.name);
  const now = nowIso();
  db.prepare(
    `INSERT INTO clients (id, name, slug, status, pipeline_stage, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(id, input.name, slug, input.pipeline_stage ?? null, input.notes ?? null, now, now);
  return getClientBySlug(slug)!;
}

export function listClients(): Client[] {
  const db = getDb();
  return db.prepare("SELECT * FROM clients ORDER BY name ASC").all() as Client[];
}

export function getClientBySlug(slug: string): Client | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM clients WHERE slug = ?").get(slug) as Client | undefined;
  return row ?? null;
}

export function getClientById(id: string): Client | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as Client | undefined;
  return row ?? null;
}

export function updateClientStatus(
  id: string,
  status: ClientStatus,
  pipeline_stage?: string
): Client | null {
  const db = getDb();
  db.prepare(
    `UPDATE clients SET status = ?, pipeline_stage = ?, updated_at = ? WHERE id = ?`
  ).run(status, pipeline_stage ?? null, nowIso(), id);
  return getClientById(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/lib/queries/clients.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/queries/clients.ts tests/lib/queries/clients.test.ts
git commit -m "feat: client queries with create/list/get/update"
```

---

### Task 6: Implement project queries with tests

**Files:**
- Create: `lib/queries/projects.ts`, `tests/lib/queries/projects.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/queries/projects.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createClient } from "../../../lib/queries/clients";
import { upsertProject, listProjects, listProjectsByClient } from "../../../lib/queries/projects";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-projects.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("project queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertProject creates a new project", () => {
    const client = createClient({ name: "Akoola" });
    const project = upsertProject({
      client_id: client.id,
      name: "VSL Ad",
      path: "/Users/c/Work/akoola-vsl",
      branch: "main",
    });
    expect(project.name).toBe("VSL Ad");
    expect(project.client_id).toBe(client.id);
  });

  it("upsertProject updates existing project by path", () => {
    const client = createClient({ name: "Akoola" });
    upsertProject({ client_id: client.id, name: "VSL", path: "/a/b", branch: "main" });
    upsertProject({ client_id: client.id, name: "VSL v2", path: "/a/b", branch: "dev" });
    const all = listProjects();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("VSL v2");
    expect(all[0].branch).toBe("dev");
  });

  it("listProjectsByClient returns only that client's projects", () => {
    const a = createClient({ name: "A" });
    const b = createClient({ name: "B" });
    upsertProject({ client_id: a.id, name: "A1", path: "/a1", branch: "main" });
    upsertProject({ client_id: b.id, name: "B1", path: "/b1", branch: "main" });
    expect(listProjectsByClient(a.id)).toHaveLength(1);
    expect(listProjectsByClient(a.id)[0].name).toBe("A1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/lib/queries/projects.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement `lib/queries/projects.ts`**

```ts
import { getDb } from "../db";
import { newId } from "../utils";
import type { Project } from "../types";

export function upsertProject(input: {
  client_id: string | null;
  name: string;
  path: string;
  repo_url?: string | null;
  branch?: string | null;
  last_commit_at?: string | null;
  last_commit_message?: string | null;
}): Project {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE path = ?").get(input.path) as Project | undefined;
  if (existing) {
    db.prepare(
      `UPDATE projects SET client_id = ?, name = ?, repo_url = ?, branch = ?, last_commit_at = ?, last_commit_message = ? WHERE id = ?`
    ).run(
      input.client_id,
      input.name,
      input.repo_url ?? null,
      input.branch ?? null,
      input.last_commit_at ?? null,
      input.last_commit_message ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as Project;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO projects (id, client_id, name, path, repo_url, branch, last_commit_at, last_commit_message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    input.client_id,
    input.name,
    input.path,
    input.repo_url ?? null,
    input.branch ?? null,
    input.last_commit_at ?? null,
    input.last_commit_message ?? null
  );
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
}

export function listProjects(): Project[] {
  const db = getDb();
  return db.prepare("SELECT * FROM projects ORDER BY last_commit_at DESC NULLS LAST").all() as Project[];
}

export function listProjectsByClient(clientId: string): Project[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY last_commit_at DESC NULLS LAST")
    .all(clientId) as Project[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/lib/queries/projects.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/queries/projects.ts tests/lib/queries/projects.test.ts
git commit -m "feat: project queries with path-based upsert"
```

---

### Task 7: Implement file, note, agent, activity, sync_status queries

**Files:**
- Create: `lib/queries/files.ts`, `lib/queries/notes.ts`, `lib/queries/agents.ts`, `lib/queries/activity.ts`, `lib/queries/sync-status.ts`
- Create: `tests/lib/queries/files.test.ts`, `tests/lib/queries/notes.test.ts`, `tests/lib/queries/agents.test.ts`, `tests/lib/queries/activity.test.ts`, `tests/lib/queries/sync-status.test.ts`

- [ ] **Step 1: Write `tests/lib/queries/files.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertFile, listFiles, listFilesByClient } from "../../../lib/queries/files";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-files.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("file queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertFile inserts a new file", () => {
    const file = upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local" });
    expect(file.name).toBe("doc.pdf");
    expect(file.source).toBe("local");
  });

  it("upsertFile updates existing file by path", () => {
    upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local", size: 100 });
    upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local", size: 200 });
    const all = listFiles();
    expect(all).toHaveLength(1);
    expect(all[0].size).toBe(200);
  });

  it("listFilesByClient returns only linked files", () => {
    const c = createClient({ name: "Akoola" });
    upsertFile({ client_id: c.id, name: "a.pdf", path: "/a.pdf", source: "local" });
    upsertFile({ name: "b.pdf", path: "/b.pdf", source: "local" });
    expect(listFilesByClient(c.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `lib/queries/files.ts`**

```ts
import { getDb } from "../db";
import { newId } from "../utils";
import type { FileRecord, FileSource } from "../types";

export function upsertFile(input: {
  client_id?: string | null;
  project_id?: string | null;
  name: string;
  path: string;
  source: FileSource;
  source_url?: string | null;
  file_type?: string | null;
  size?: number | null;
  modified_at?: string | null;
}): FileRecord {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM files WHERE path = ?").get(input.path) as FileRecord | undefined;
  if (existing) {
    db.prepare(
      `UPDATE files SET client_id = ?, project_id = ?, name = ?, source = ?, source_url = ?, file_type = ?, size = ?, modified_at = ? WHERE id = ?`
    ).run(
      input.client_id ?? null,
      input.project_id ?? null,
      input.name,
      input.source,
      input.source_url ?? null,
      input.file_type ?? null,
      input.size ?? null,
      input.modified_at ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM files WHERE id = ?").get(existing.id) as FileRecord;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO files (id, client_id, project_id, name, path, source, source_url, file_type, size, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.project_id ?? null,
    input.name,
    input.path,
    input.source,
    input.source_url ?? null,
    input.file_type ?? null,
    input.size ?? null,
    input.modified_at ?? null
  );
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRecord;
}

export function listFiles(limit = 500): FileRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM files ORDER BY modified_at DESC NULLS LAST LIMIT ?").all(limit) as FileRecord[];
}

export function listFilesByClient(clientId: string, limit = 100): FileRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM files WHERE client_id = ? ORDER BY modified_at DESC NULLS LAST LIMIT ?")
    .all(clientId, limit) as FileRecord[];
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npm test -- tests/lib/queries/files.test.ts
```
Expected: PASS

- [ ] **Step 4: Write `tests/lib/queries/notes.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertNote, listNotes, listNotesByClient } from "../../../lib/queries/notes";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-notes.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("note queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertNote inserts a new note", () => {
    const note = upsertNote({ title: "Strategy", source: "notion", source_url: "https://notion.so/x" });
    expect(note.title).toBe("Strategy");
  });

  it("upsertNote updates by source_url", () => {
    upsertNote({ title: "A", source: "notion", source_url: "https://notion.so/1", content_preview: "v1" });
    upsertNote({ title: "A", source: "notion", source_url: "https://notion.so/1", content_preview: "v2" });
    const all = listNotes();
    expect(all).toHaveLength(1);
    expect(all[0].content_preview).toBe("v2");
  });

  it("listNotesByClient filters correctly", () => {
    const c = createClient({ name: "Akoola" });
    upsertNote({ client_id: c.id, title: "A", source: "notion", source_url: "https://notion.so/a" });
    upsertNote({ title: "B", source: "notion", source_url: "https://notion.so/b" });
    expect(listNotesByClient(c.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Implement `lib/queries/notes.ts`**

```ts
import { getDb } from "../db";
import { newId } from "../utils";
import type { Note, NoteSource } from "../types";

export function upsertNote(input: {
  client_id?: string | null;
  title: string;
  content_preview?: string | null;
  source: NoteSource;
  source_url: string;
  tags?: string | null;
  modified_at?: string | null;
}): Note {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM notes WHERE source_url = ?").get(input.source_url) as Note | undefined;
  if (existing) {
    db.prepare(
      `UPDATE notes SET client_id = ?, title = ?, content_preview = ?, source = ?, tags = ?, modified_at = ? WHERE id = ?`
    ).run(
      input.client_id ?? null,
      input.title,
      input.content_preview ?? null,
      input.source,
      input.tags ?? null,
      input.modified_at ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM notes WHERE id = ?").get(existing.id) as Note;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO notes (id, client_id, title, content_preview, source, source_url, tags, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.title,
    input.content_preview ?? null,
    input.source,
    input.source_url,
    input.tags ?? null,
    input.modified_at ?? null
  );
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Note;
}

export function listNotes(limit = 200): Note[] {
  const db = getDb();
  return db.prepare("SELECT * FROM notes ORDER BY modified_at DESC NULLS LAST LIMIT ?").all(limit) as Note[];
}

export function listNotesByClient(clientId: string, limit = 50): Note[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM notes WHERE client_id = ? ORDER BY modified_at DESC NULLS LAST LIMIT ?")
    .all(clientId, limit) as Note[];
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/lib/queries/notes.test.ts
```
Expected: PASS

- [ ] **Step 7: Write `tests/lib/queries/agents.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertAgent, listAgents, getAgentByName } from "../../../lib/queries/agents";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-agents.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("agent queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertAgent inserts and retrieves by name", () => {
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "running" });
    const a = getAgentByName("WeatherBot");
    expect(a?.type).toBe("discord_bot");
  });

  it("upsertAgent updates existing agent", () => {
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "running" });
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "errored" });
    expect(getAgentByName("WeatherBot")?.status).toBe("errored");
    expect(listAgents()).toHaveLength(1);
  });
});
```

- [ ] **Step 8: Implement `lib/queries/agents.ts`**

```ts
import { getDb } from "../db";
import { newId } from "../utils";
import type { Agent, AgentType, AgentStatus } from "../types";

export function upsertAgent(input: {
  name: string;
  type: AgentType;
  schedule?: string | null;
  host?: string;
  status: AgentStatus;
  last_run_at?: string | null;
  last_output?: string | null;
  config_path?: string | null;
}): Agent {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM agents WHERE name = ?").get(input.name) as Agent | undefined;
  if (existing) {
    db.prepare(
      `UPDATE agents SET type = ?, schedule = ?, host = ?, status = ?, last_run_at = ?, last_output = ?, config_path = ? WHERE id = ?`
    ).run(
      input.type,
      input.schedule ?? null,
      input.host ?? "mac_mini",
      input.status,
      input.last_run_at ?? null,
      input.last_output ?? null,
      input.config_path ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM agents WHERE id = ?").get(existing.id) as Agent;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO agents (id, name, type, schedule, host, status, last_run_at, last_output, config_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.type,
    input.schedule ?? null,
    input.host ?? "mac_mini",
    input.status,
    input.last_run_at ?? null,
    input.last_output ?? null,
    input.config_path ?? null
  );
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
}

export function listAgents(): Agent[] {
  const db = getDb();
  return db.prepare("SELECT * FROM agents ORDER BY name ASC").all() as Agent[];
}

export function getAgentByName(name: string): Agent | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as Agent | undefined;
  return row ?? null;
}
```

- [ ] **Step 9: Run tests**

```bash
npm test -- tests/lib/queries/agents.test.ts
```
Expected: PASS

- [ ] **Step 10: Write `tests/lib/queries/activity.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { recordActivity, listRecentActivity, listActivityByClient } from "../../../lib/queries/activity";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-activity.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("activity queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("recordActivity inserts an entry", () => {
    const e = recordActivity({ source: "git", event_type: "commit", title: "Initial commit" });
    expect(e.title).toBe("Initial commit");
  });

  it("listRecentActivity returns entries newest first", () => {
    recordActivity({ source: "git", event_type: "commit", title: "old", timestamp: "2026-04-01T00:00:00Z" });
    recordActivity({ source: "git", event_type: "commit", title: "new", timestamp: "2026-04-10T00:00:00Z" });
    const all = listRecentActivity(10);
    expect(all[0].title).toBe("new");
  });

  it("listActivityByClient filters by client", () => {
    const c = createClient({ name: "Akoola" });
    recordActivity({ client_id: c.id, source: "git", event_type: "commit", title: "A" });
    recordActivity({ source: "system", event_type: "sync_error", title: "B" });
    expect(listActivityByClient(c.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 11: Implement `lib/queries/activity.ts`**

```ts
import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { ActivityEntry } from "../types";

export function recordActivity(input: {
  client_id?: string | null;
  agent_id?: string | null;
  source: string;
  event_type: string;
  title: string;
  detail?: string | null;
  timestamp?: string;
}): ActivityEntry {
  const db = getDb();
  const id = newId();
  const timestamp = input.timestamp ?? nowIso();
  db.prepare(
    `INSERT INTO activity (id, client_id, agent_id, source, event_type, title, detail, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.agent_id ?? null,
    input.source,
    input.event_type,
    input.title,
    input.detail ?? null,
    timestamp
  );
  return db.prepare("SELECT * FROM activity WHERE id = ?").get(id) as ActivityEntry;
}

export function listRecentActivity(limit = 50): ActivityEntry[] {
  const db = getDb();
  return db.prepare("SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?").all(limit) as ActivityEntry[];
}

export function listActivityByClient(clientId: string, limit = 50): ActivityEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM activity WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?")
    .all(clientId, limit) as ActivityEntry[];
}
```

- [ ] **Step 12: Run tests**

```bash
npm test -- tests/lib/queries/activity.test.ts
```
Expected: PASS

- [ ] **Step 13: Write `tests/lib/queries/sync-status.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { recordSyncRun, listSyncStatuses } from "../../../lib/queries/sync-status";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-status.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync_status queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("recordSyncRun inserts a new sync entry", () => {
    recordSyncRun({ sync_name: "sync-projects", status: "ok", duration_ms: 150 });
    const statuses = listSyncStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("ok");
  });

  it("recordSyncRun upserts by sync_name", () => {
    recordSyncRun({ sync_name: "sync-projects", status: "ok", duration_ms: 150 });
    recordSyncRun({ sync_name: "sync-projects", status: "error", error_message: "boom" });
    const statuses = listSyncStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("error");
    expect(statuses[0].error_message).toBe("boom");
  });
});
```

- [ ] **Step 14: Implement `lib/queries/sync-status.ts`**

```ts
import { getDb } from "../db";
import { nowIso } from "../utils";
import type { SyncStatusRecord, SyncStatus } from "../types";

export function recordSyncRun(input: {
  sync_name: string;
  status: SyncStatus;
  error_message?: string | null;
  duration_ms?: number | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_status (sync_name, last_run_at, status, error_message, duration_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sync_name) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       status = excluded.status,
       error_message = excluded.error_message,
       duration_ms = excluded.duration_ms`
  ).run(input.sync_name, nowIso(), input.status, input.error_message ?? null, input.duration_ms ?? null);
}

export function listSyncStatuses(): SyncStatusRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sync_status ORDER BY sync_name ASC").all() as SyncStatusRecord[];
}
```

- [ ] **Step 15: Run all query tests**

```bash
npm test
```
Expected: All query tests PASS.

- [ ] **Step 16: Commit**

```bash
git add lib/queries/ tests/lib/queries/
git commit -m "feat: file, note, agent, activity, sync_status queries with tests"
```

---

## Phase 3: API Routes

### Task 8: Implement API routes

**Files:**
- Create: `app/api/clients/route.ts`, `app/api/clients/[slug]/route.ts`, `app/api/system/route.ts`, `app/api/files/route.ts`, `app/api/notes/route.ts`, `app/api/activity/route.ts`

- [ ] **Step 1: Create `app/api/clients/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/queries/clients";

export async function GET() {
  const clients = listClients();
  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const client = createClient({
    name: body.name,
    pipeline_stage: body.pipeline_stage,
    notes: body.notes,
  });
  return NextResponse.json({ client }, { status: 201 });
}
```

- [ ] **Step 2: Create `app/api/clients/[slug]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getClientBySlug, updateClientStatus } from "@/lib/queries/clients";
import { listProjectsByClient } from "@/lib/queries/projects";
import { listFilesByClient } from "@/lib/queries/files";
import { listNotesByClient } from "@/lib/queries/notes";
import { listActivityByClient } from "@/lib/queries/activity";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    client,
    projects: listProjectsByClient(client.id),
    files: listFilesByClient(client.id),
    notes: listNotesByClient(client.id),
    activity: listActivityByClient(client.id),
  });
}

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const updated = updateClientStatus(client.id, body.status, body.pipeline_stage);
  return NextResponse.json({ client: updated });
}
```

- [ ] **Step 3: Create `app/api/system/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listAgents } from "@/lib/queries/agents";
import { listSyncStatuses } from "@/lib/queries/sync-status";

export async function GET() {
  return NextResponse.json({
    agents: listAgents(),
    sync: listSyncStatuses(),
  });
}
```

- [ ] **Step 4: Create `app/api/files/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listFiles } from "@/lib/queries/files";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
  return NextResponse.json({ files: listFiles(limit) });
}
```

- [ ] **Step 5: Create `app/api/notes/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listNotes } from "@/lib/queries/notes";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
  return NextResponse.json({ notes: listNotes(limit) });
}
```

- [ ] **Step 6: Create `app/api/activity/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listRecentActivity } from "@/lib/queries/activity";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  return NextResponse.json({ activity: listRecentActivity(limit) });
}
```

- [ ] **Step 7: Commit**

```bash
git add app/api/
git commit -m "feat: REST API routes for clients, system, files, notes, activity"
```

---

## Phase 4: UI Components

### Task 9: Build reusable UI components

**Files:**
- Create: `components/Card.tsx`, `components/StatusDot.tsx`, `components/Badge.tsx`, `components/StatCard.tsx`, `components/Breadcrumb.tsx`

- [ ] **Step 1: Create `components/Card.tsx`**

```tsx
import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`bg-card border border-border rounded-card p-4 ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  label: string;
  right?: React.ReactNode;
}

export function CardHeader({ label, right }: CardHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-3">
      <div className="text-2xs uppercase tracking-wider font-medium text-text-secondary">
        {label}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/StatusDot.tsx`**

```tsx
interface StatusDotProps {
  status: "green" | "amber" | "red" | "gray";
  size?: number;
}

const colors = {
  green: "bg-accent-green",
  amber: "bg-accent-amber",
  red: "bg-accent-red",
  gray: "bg-text-muted",
};

export function StatusDot({ status, size = 8 }: StatusDotProps) {
  return (
    <div
      className={`rounded-full shrink-0 ${colors[status]}`}
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 3: Create `components/Badge.tsx`**

```tsx
interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "amber" | "red" | "gray";
}

const styles = {
  green: "bg-accent-green/10 text-accent-green",
  amber: "bg-accent-amber/10 text-accent-amber",
  red: "bg-accent-red/10 text-accent-red",
  gray: "bg-hover text-text-secondary",
};

export function Badge({ children, variant = "gray" }: BadgeProps) {
  return (
    <span className={`text-2xs px-2 py-0.5 rounded-badge font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Create `components/StatCard.tsx`**

```tsx
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  subtextColor?: "green" | "amber" | "red" | "gray";
}

const subtextColors = {
  green: "text-accent-green",
  amber: "text-accent-amber",
  red: "text-accent-red",
  gray: "text-text-secondary",
};

export function StatCard({ label, value, subtext, subtextColor = "gray" }: StatCardProps) {
  return (
    <Card>
      <div className="text-2xs uppercase tracking-wider font-medium text-text-secondary">
        {label}
      </div>
      <div className="mono text-2xl font-semibold text-text-primary mt-1">{value}</div>
      {subtext && <div className={`text-2xs mt-1 ${subtextColors[subtextColor]}`}>{subtext}</div>}
    </Card>
  );
}
```

- [ ] **Step 5: Create `components/Breadcrumb.tsx`**

```tsx
import Link from "next/link";

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <div className="flex items-center gap-1.5 mb-4 text-xs">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {item.href ? (
            <Link href={item.href} className="text-text-secondary hover:text-text-primary">
              {item.label}
            </Link>
          ) : (
            <span className="text-text-primary font-medium">{item.label}</span>
          )}
          {i < items.length - 1 && <span className="text-text-muted">/</span>}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/Card.tsx components/StatusDot.tsx components/Badge.tsx components/StatCard.tsx components/Breadcrumb.tsx
git commit -m "feat: reusable UI components (Card, StatusDot, Badge, StatCard, Breadcrumb)"
```

---

### Task 10: Build collapsible sidebar component

**Files:**
- Create: `components/Sidebar.tsx`

- [ ] **Step 1: Install lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 2: Create `components/Sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Users, Cpu, FileText, StickyNote, Settings } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/agents", label: "Agents", icon: Cpu },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/notes", label: "Notes", icon: StickyNote },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="group fixed top-0 left-0 h-screen w-14 hover:w-56 bg-card border-r border-border transition-all duration-200 ease-out overflow-hidden z-50 flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border flex items-center gap-2.5 whitespace-nowrap">
        <div className="w-6 h-6 bg-accent-green/15 rounded-md flex items-center justify-center shrink-0">
          <LayoutGrid size={14} className="text-accent-green" />
        </div>
        <span className="mono text-sm font-semibold text-text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Command Center
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-accent-green/10 text-accent-green"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              }`}
            >
              <div className="shrink-0 ml-1">
                <Icon size={16} />
              </div>
              <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                {item.label}
              </span>
            </Link>
          );
        })}
        <div className="flex-1" />
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md transition-colors whitespace-nowrap ${
            pathname === "/settings"
              ? "bg-accent-green/10 text-accent-green"
              : "text-text-secondary hover:bg-hover hover:text-text-primary"
          }`}
        >
          <div className="shrink-0 ml-1">
            <Settings size={16} />
          </div>
          <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            Settings
          </span>
        </Link>
      </nav>

      {/* Sync footer */}
      <div className="px-4 py-3 border-t border-border whitespace-nowrap">
        <div className="flex gap-1 group-hover:justify-start justify-center">
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-amber rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
        </div>
        <div className="mono text-text-muted text-[9px] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          Synced 2m ago
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/Sidebar.tsx package.json package-lock.json
git commit -m "feat: collapsible sidebar with hover expand"
```

---

### Task 11: Build root layout with sidebar

**Files:**
- Create: `app/layout.tsx`

- [ ] **Step 1: Create `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Command Center",
  description: "Unified dashboard for clients, agents, and system health",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main className="ml-14 min-h-screen p-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Run dev server and verify layout**

```bash
npm run dev
```
Open `http://localhost:3000` in browser. Expected: dark background, sidebar with icons on left, empty main content area. Hover over sidebar to see it expand.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: root layout with fixed sidebar"
```

---

## Phase 5: Dashboard Home Page

### Task 12: Build dashboard home page

**Files:**
- Create: `app/page.tsx`, `components/ClientPipeline.tsx`, `components/ActivityFeed.tsx`

- [ ] **Step 1: Create `components/ClientPipeline.tsx`**

```tsx
import { Card, CardHeader } from "./Card";
import { StatusDot } from "./StatusDot";
import { Badge } from "./Badge";
import type { Client } from "@/lib/types";

const statusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export function ClientPipeline({ clients }: { clients: Client[] }) {
  return (
    <Card>
      <CardHeader label="Client Pipeline" />
      {clients.length === 0 ? (
        <p className="text-xs text-text-muted">No clients yet. Add one in Settings.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {clients.map((c) => (
            <div key={c.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={statusToDot(c.status)} />
                <span className="text-xs text-text-primary font-medium">{c.name}</span>
              </div>
              {c.pipeline_stage && <Badge>{c.pipeline_stage}</Badge>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Create `components/ActivityFeed.tsx`**

```tsx
import { Card, CardHeader } from "./Card";
import { formatRelativeTime } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/types";

const borderColors: Record<string, string> = {
  git: "border-accent-green",
  notion: "border-accent-green",
  gdrive: "border-accent-green",
  discord: "border-accent-green",
  files: "border-accent-green",
  system: "border-accent-amber",
};

export function ActivityFeed({ items }: { items: ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader label="Recent Activity" />
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((a) => (
            <div key={a.id} className={`border-l-2 pl-2.5 ${borderColors[a.source] ?? "border-accent-green"}`}>
              <div className="text-xs text-text-primary">{a.title}</div>
              <div className="mono text-[10px] text-text-muted">
                {formatRelativeTime(a.timestamp)} · {a.source}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Create `app/page.tsx`**

```tsx
import { StatCard } from "@/components/StatCard";
import { ClientPipeline } from "@/components/ClientPipeline";
import { ActivityFeed } from "@/components/ActivityFeed";
import { listClients } from "@/lib/queries/clients";
import { listAgents } from "@/lib/queries/agents";
import { listRecentActivity } from "@/lib/queries/activity";
import { listFiles } from "@/lib/queries/files";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const clients = listClients();
  const agents = listAgents();
  const activity = listRecentActivity(10);
  const files = listFiles(1000);

  const activeClients = clients.filter((c) => c.status === "active").length;
  const runningAgents = agents.filter((a) => a.status === "running").length;
  const cronJobs = agents.filter((a) => a.type === "cron").length;

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Dashboard</h1>
        <p className="text-xs text-text-muted mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Clients" value={clients.length} subtext={`${activeClients} active`} subtextColor="green" />
        <StatCard label="Agents" value={runningAgents} subtext="running" />
        <StatCard label="Cron Jobs" value={cronJobs} subtext="scheduled" />
        <StatCard label="Files" value={files.length} subtext="indexed" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ClientPipeline clients={clients} />
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify dashboard renders**

```bash
npm run dev
```
Open `http://localhost:3000`. Expected: stat cards showing zeros, empty pipeline with "No clients yet" message, empty activity with "No activity yet" message.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/ClientPipeline.tsx components/ActivityFeed.tsx
git commit -m "feat: dashboard home with stat cards, pipeline, activity feed"
```

---

## Phase 6: Client Hub Pages

### Task 13: Build clients list page

**Files:**
- Create: `app/clients/page.tsx`

- [ ] **Step 1: Create `app/clients/page.tsx`**

```tsx
import Link from "next/link";
import { Card } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/Badge";
import { listClients } from "@/lib/queries/clients";

export const dynamic = "force-dynamic";

const statusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export default function ClientsListPage() {
  const clients = listClients();

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Clients</h1>
        <p className="text-xs text-text-muted mt-0.5">{clients.length} total</p>
      </div>

      {clients.length === 0 ? (
        <Card>
          <p className="text-xs text-text-muted">No clients yet. Add one in Settings.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.slug}`}>
              <Card className="hover:bg-hover transition-colors cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-hover border border-border rounded-md flex items-center justify-center">
                    <span className="mono text-base font-semibold text-text-primary">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="mono text-sm font-semibold text-text-primary">{c.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot status={statusToDot(c.status)} size={6} />
                      <span className="text-[10px] text-text-muted capitalize">{c.status}</span>
                    </div>
                  </div>
                </div>
                {c.pipeline_stage && <Badge>{c.pipeline_stage}</Badge>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify page**

Open `http://localhost:3000/clients`. Expected: "Clients" heading, "0 total", and "No clients yet" card.

- [ ] **Step 3: Commit**

```bash
git add app/clients/page.tsx
git commit -m "feat: clients list page"
```

---

### Task 14: Build client hub (drill-down) page

**Files:**
- Create: `app/clients/[slug]/page.tsx`

- [ ] **Step 1: Create `app/clients/[slug]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/Card";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Badge } from "@/components/Badge";
import { StatusDot } from "@/components/StatusDot";
import { formatRelativeTime } from "@/lib/utils";
import { getClientBySlug } from "@/lib/queries/clients";
import { listProjectsByClient } from "@/lib/queries/projects";
import { listFilesByClient } from "@/lib/queries/files";
import { listNotesByClient } from "@/lib/queries/notes";
import { listActivityByClient } from "@/lib/queries/activity";

export const dynamic = "force-dynamic";

const statusToBadge = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export default function ClientHubPage({ params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) notFound();

  const projects = listProjectsByClient(client.id);
  const files = listFilesByClient(client.id, 5);
  const notes = listNotesByClient(client.id, 5);
  const activity = listActivityByClient(client.id, 10);

  return (
    <div>
      <Breadcrumb items={[{ label: "Clients", href: "/clients" }, { label: client.name }]} />

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-hover border border-border rounded-md flex items-center justify-center">
            <span className="mono text-base font-semibold text-text-primary">
              {client.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="mono text-lg font-semibold text-text-primary">{client.name}</div>
            <div className="text-xs text-text-muted mt-0.5">
              Client since {new Date(client.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        {client.pipeline_stage && (
          <Badge variant={statusToBadge(client.status)}>{client.pipeline_stage}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Projects */}
        <Card>
          <CardHeader label="Projects" right={<span className="text-2xs text-text-muted">{projects.length} total</span>} />
          {projects.length === 0 ? (
            <p className="text-xs text-text-muted">No projects linked yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div>
                    <div className="text-xs text-text-primary font-medium">{p.name}</div>
                    <div className="mono text-[10px] text-text-muted">
                      {p.branch ?? "—"} · {p.last_commit_at ? formatRelativeTime(p.last_commit_at) : "no commits"}
                    </div>
                  </div>
                  <StatusDot
                    status={p.last_commit_at && new Date(p.last_commit_at).getTime() > Date.now() - 86400000 ? "green" : "gray"}
                    size={7}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Files */}
        <Card>
          <CardHeader label="Recent Files" right={<span className="text-2xs text-text-muted">View all</span>} />
          {files.length === 0 ? (
            <p className="text-xs text-text-muted">No files linked yet.</p>
          ) : (
            <div>
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 py-2 border-b border-hover last:border-0">
                  <div className="flex-1">
                    <div className="text-xs text-text-primary">{f.name}</div>
                    <div className="text-[10px] text-text-muted capitalize">
                      {f.source.replace("_", " ")} · {f.modified_at ? formatRelativeTime(f.modified_at) : "unknown"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader label="Notes" right={<span className="text-2xs text-text-muted">{notes.length} total</span>} />
          {notes.length === 0 ? (
            <p className="text-xs text-text-muted">No notes linked yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
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
            </div>
          )}
        </Card>

        {/* Activity */}
        <Card>
          <CardHeader label="Activity" />
          {activity.length === 0 ? (
            <p className="text-xs text-text-muted">No activity yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activity.map((a) => (
                <div key={a.id} className="border-l-2 border-accent-green pl-2.5">
                  <div className="text-xs text-text-primary">{a.title}</div>
                  <div className="mono text-[10px] text-text-muted">
                    {formatRelativeTime(a.timestamp)} · {a.source}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify page**

Open `http://localhost:3000/clients/some-slug`. Expected: 404 page (no clients in DB yet).

- [ ] **Step 3: Commit**

```bash
git add app/clients/[slug]/page.tsx
git commit -m "feat: client hub drill-down page with projects, files, notes, activity"
```

---

## Phase 7: System Monitoring Pages

### Task 15: Build Agents & System page

**Files:**
- Create: `app/agents/page.tsx`, `components/SyncHealth.tsx`

- [ ] **Step 1: Create `components/SyncHealth.tsx`**

```tsx
import { Card, CardHeader } from "./Card";
import type { SyncStatusRecord } from "@/lib/types";

export function SyncHealth({ items }: { items: SyncStatusRecord[] }) {
  return (
    <Card>
      <CardHeader label="Sync Health" />
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">No sync runs yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((s) => {
            const isOk = s.status === "ok";
            const label = s.sync_name.replace(/^sync-/, "").replace(/-/g, " ");
            return (
              <div key={s.sync_name}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-text-primary capitalize">{label}</span>
                  <span className={`text-2xs ${isOk ? "text-accent-green" : "text-accent-amber"}`}>
                    {s.status}
                  </span>
                </div>
                <div className="h-[3px] bg-hover rounded-sm">
                  <div
                    className={`h-full rounded-sm ${isOk ? "bg-accent-green w-full" : "bg-accent-amber w-2/5"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Create `app/agents/page.tsx`**

```tsx
import { Card, CardHeader } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { SyncHealth } from "@/components/SyncHealth";
import { listAgents } from "@/lib/queries/agents";
import { listSyncStatuses } from "@/lib/queries/sync-status";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const agentStatusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "running") return "green";
  if (status === "errored") return "red";
  if (status === "stopped") return "gray";
  return "gray";
};

export default function AgentsSystemPage() {
  const agents = listAgents();
  const sync = listSyncStatuses();

  const cronJobs = agents.filter((a) => a.type === "cron");
  const discordBots = agents.filter((a) => a.type === "discord_bot");
  const otherAgents = agents.filter((a) => a.type !== "cron" && a.type !== "discord_bot");

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Agents &amp; System</h1>
        <p className="text-xs text-text-muted mt-0.5">Mac Mini · via Tailscale</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Agents */}
        <Card>
          <CardHeader
            label="Agents"
            right={<span className="text-2xs text-accent-green font-medium">{otherAgents.filter((a) => a.status === "running").length} running</span>}
          />
          {otherAgents.length === 0 ? (
            <p className="text-xs text-text-muted">No agents registered yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {otherAgents.map((a) => (
                <div key={a.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={agentStatusToDot(a.status)} />
                    <div>
                      <div className="text-xs text-text-primary font-medium">{a.name}</div>
                      <div className="mono text-[10px] text-text-muted">
                        {a.type} {a.schedule ? `· ${a.schedule}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {a.last_run_at ? formatRelativeTime(a.last_run_at) : "never"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Discord Bots */}
        <Card>
          <CardHeader
            label="Discord Bots"
            right={<span className="text-2xs text-accent-green font-medium">{discordBots.filter((a) => a.status === "running").length} online</span>}
          />
          {discordBots.length === 0 ? (
            <p className="text-xs text-text-muted">No bots registered yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {discordBots.map((a) => (
                <div key={a.id}>
                  <div className="flex items-center justify-between bg-base rounded p-2.5">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={agentStatusToDot(a.status)} />
                      <div>
                        <div className="text-xs text-text-primary font-medium">{a.name}</div>
                        <div className="mono text-[10px] text-text-muted">{a.schedule ?? "on event"}</div>
                      </div>
                    </div>
                  </div>
                  {a.last_output && (
                    <div className="mono text-[10px] text-text-secondary bg-base border-l-2 border-border rounded p-2.5 mt-1 whitespace-pre-wrap">
                      {a.last_output}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[1.4fr_0.6fr] gap-3">
        {/* Cron jobs */}
        <Card>
          <CardHeader label="Cron Jobs (Mac Mini)" />
          {cronJobs.length === 0 ? (
            <p className="text-xs text-text-muted">No cron jobs registered yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_1.2fr_0.6fr_0.5fr] gap-2 px-3 text-2xs uppercase tracking-wider text-text-muted">
                <div>Job</div>
                <div>Schedule</div>
                <div>Last Run</div>
                <div>Status</div>
              </div>
              {cronJobs.map((a) => (
                <div
                  key={a.id}
                  className="grid grid-cols-[1fr_1.2fr_0.6fr_0.5fr] gap-2 p-3 bg-base rounded items-center"
                >
                  <div className="text-xs text-text-primary">{a.name}</div>
                  <div className="mono text-[10px] text-text-secondary">{a.schedule ?? "—"}</div>
                  <div className="text-[10px] text-text-secondary">
                    {a.last_run_at ? formatRelativeTime(a.last_run_at) : "never"}
                  </div>
                  <div>
                    <StatusDot status={agentStatusToDot(a.status)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <SyncHealth items={sync} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify page**

Open `http://localhost:3000/agents`. Expected: four empty cards with "No ... registered yet" messages.

- [ ] **Step 4: Commit**

```bash
git add app/agents/page.tsx components/SyncHealth.tsx
git commit -m "feat: agents and system monitoring page"
```

---

## Phase 8: Files, Notes, Settings Pages

### Task 16: Build files and notes pages

**Files:**
- Create: `app/files/page.tsx`, `app/notes/page.tsx`

- [ ] **Step 1: Create `app/files/page.tsx`**

```tsx
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { listFiles } from "@/lib/queries/files";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function FilesPage() {
  const files = listFiles(500);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Files</h1>
        <p className="text-xs text-text-muted mt-0.5">{files.length} files indexed</p>
      </div>

      <Card>
        {files.length === 0 ? (
          <p className="text-xs text-text-muted">No files indexed yet. Run sync-projects or configure Drive sync.</p>
        ) : (
          <div className="flex flex-col">
            {files.map((f) => (
              <div
                key={f.id}
                className="grid grid-cols-[1fr_auto_auto] gap-4 py-2.5 border-b border-hover last:border-0 items-center"
              >
                <div>
                  <div className="text-xs text-text-primary">{f.name}</div>
                  <div className="text-[10px] text-text-muted mono">{f.path}</div>
                </div>
                <Badge>{f.source}</Badge>
                <div className="text-[10px] text-text-secondary">
                  {f.modified_at ? formatRelativeTime(f.modified_at) : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/notes/page.tsx`**

```tsx
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { listNotes } from "@/lib/queries/notes";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function NotesPage() {
  const notes = listNotes(200);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Notes</h1>
        <p className="text-xs text-text-muted mt-0.5">{notes.length} notes aggregated</p>
      </div>

      {notes.length === 0 ? (
        <Card>
          <p className="text-xs text-text-muted">
            No notes aggregated yet. Notion, Apple Notes, and Obsidian sync are deferred to v2.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {notes.map((n) => (
            <Card key={n.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-text-primary font-medium">{n.title}</span>
                <Badge>{n.source.replace("_", " ")}</Badge>
              </div>
              {n.content_preview && (
                <p className="text-xs text-text-secondary line-clamp-3">{n.content_preview}</p>
              )}
              <div className="text-[10px] text-text-muted mono mt-2">
                {n.modified_at ? formatRelativeTime(n.modified_at) : "—"}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify pages**

Open `http://localhost:3000/files` and `http://localhost:3000/notes`. Expected: empty-state cards.

- [ ] **Step 4: Commit**

```bash
git add app/files/page.tsx app/notes/page.tsx
git commit -m "feat: files and notes browser pages"
```

---

### Task 17: Build settings page with client management form

**Files:**
- Create: `app/settings/page.tsx`, `components/AddClientForm.tsx`

- [ ] **Step 1: Create `components/AddClientForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pipelineStage, setPipelineStage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pipeline_stage: pipelineStage || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed to create");
      setName("");
      setPipelineStage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="text-2xs uppercase tracking-wider text-text-secondary block mb-1">
          Client Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Akoola"
          required
          className="w-full bg-base border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-green"
        />
      </div>
      <div>
        <label className="text-2xs uppercase tracking-wider text-text-secondary block mb-1">
          Pipeline Stage (optional)
        </label>
        <input
          type="text"
          value={pipelineStage}
          onChange={(e) => setPipelineStage(e.target.value)}
          placeholder="scripts delivered"
          className="w-full bg-base border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-green"
        />
      </div>
      {error && <div className="text-xs text-accent-red">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !name}
        className="bg-accent-green/10 text-accent-green text-xs font-medium rounded py-2 disabled:opacity-50 hover:bg-accent-green/20 transition-colors"
      >
        {submitting ? "Adding..." : "Add Client"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create `app/settings/page.tsx`**

```tsx
import { Card, CardHeader } from "@/components/Card";
import { AddClientForm } from "@/components/AddClientForm";
import { listClients } from "@/lib/queries/clients";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const clients = listClients();

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Settings</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader label="Add Client" />
          <AddClientForm />
        </Card>

        <Card>
          <CardHeader label="Current Clients" right={<span className="text-2xs text-text-muted">{clients.length}</span>} />
          {clients.length === 0 ? (
            <p className="text-xs text-text-muted">No clients yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div>
                    <div className="text-xs text-text-primary font-medium">{c.name}</div>
                    <div className="mono text-[10px] text-text-muted">{c.slug}</div>
                  </div>
                  <span className="text-[10px] text-text-secondary capitalize">{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify settings page adds clients**

1. Open `http://localhost:3000/settings`
2. Add a client named "Akoola" with stage "scripts delivered"
3. Verify it appears in the "Current Clients" list
4. Navigate to `/` (dashboard) — should show 1 client
5. Navigate to `/clients` — should show Akoola card
6. Click Akoola — should load client hub

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx components/AddClientForm.tsx
git commit -m "feat: settings page with add client form"
```

---

## Phase 9: Sync Scripts

### Task 18: Build sync-projects script

**Files:**
- Create: `scripts/sync-projects.ts`, `tests/scripts/sync-projects.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/scripts/sync-projects.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { scanDirectoryForProjects } from "../../scripts/sync-projects";
import { listProjects } from "../../lib/queries/projects";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-projects.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync-projects", () => {
  let tmpDir: string;

  beforeEach(() => {
    initTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-proj-"));
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans a directory and finds git repos", async () => {
    // Create a fake project with a .git directory
    const projectPath = path.join(tmpDir, "my-project");
    fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });

    scanDirectoryForProjects(tmpDir);
    const projects = listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("my-project");
  });

  it("ignores non-git directories", async () => {
    fs.mkdirSync(path.join(tmpDir, "not-a-repo"));
    scanDirectoryForProjects(tmpDir);
    expect(listProjects()).toHaveLength(0);
  });

  it("updates existing project on re-scan", () => {
    const projectPath = path.join(tmpDir, "my-project");
    fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });
    scanDirectoryForProjects(tmpDir);
    scanDirectoryForProjects(tmpDir);
    expect(listProjects()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/scripts/sync-projects.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement `scripts/sync-projects.ts`**

```ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { upsertProject } from "../lib/queries/projects";
import { recordSyncRun } from "../lib/queries/sync-status";
import { closeDb } from "../lib/db";

interface GitInfo {
  branch: string | null;
  last_commit_at: string | null;
  last_commit_message: string | null;
  repo_url: string | null;
}

function readGitInfo(repoPath: string): GitInfo {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    const commitLog = execSync('git log -1 --format="%cI|%s"', { cwd: repoPath, encoding: "utf-8" }).trim();
    const [last_commit_at, last_commit_message] = commitLog.split("|");
    let repo_url: string | null = null;
    try {
      repo_url = execSync("git config --get remote.origin.url", { cwd: repoPath, encoding: "utf-8" }).trim();
    } catch {
      // no remote
    }
    return { branch, last_commit_at, last_commit_message, repo_url };
  } catch {
    return { branch: null, last_commit_at: null, last_commit_message: null, repo_url: null };
  }
}

export function scanDirectoryForProjects(rootPath: string, depth = 2): void {
  if (!fs.existsSync(rootPath)) return;

  function walk(dir: string, remainingDepth: number): void {
    if (remainingDepth < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasGit = entries.some((e) => e.isDirectory() && e.name === ".git");
    if (hasGit) {
      const git = readGitInfo(dir);
      upsertProject({
        client_id: null,
        name: path.basename(dir),
        path: dir,
        repo_url: git.repo_url,
        branch: git.branch,
        last_commit_at: git.last_commit_at,
        last_commit_message: git.last_commit_message,
      });
      return; // don't recurse into a git repo
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      walk(path.join(dir, entry.name), remainingDepth - 1);
    }
  }

  walk(rootPath, depth);
}

function main(): void {
  const start = Date.now();
  const workDir = process.env.WORK_DIR ?? path.join(process.env.HOME ?? "", "Work");
  try {
    scanDirectoryForProjects(workDir);
    recordSyncRun({ sync_name: "sync-projects", status: "ok", duration_ms: Date.now() - start });
    console.log(`sync-projects: ok (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncRun({ sync_name: "sync-projects", status: "error", error_message: msg, duration_ms: Date.now() - start });
    console.error(`sync-projects: error — ${msg}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

// Only run if invoked directly
if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/scripts/sync-projects.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Run sync against real ~/Work directory**

```bash
npm run sync:projects
```
Expected: "sync-projects: ok (Nms)" with some number of projects picked up. Verify by opening `http://localhost:3000` — the Dashboard should not have projects as a top-level stat, but the database now has them.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-projects.ts tests/scripts/sync-projects.test.ts
git commit -m "feat: sync-projects script scans ~/Work for git repos"
```

---

### Task 19: Build sync-cron script

**Files:**
- Create: `scripts/sync-cron.ts`, `tests/scripts/sync-cron.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/scripts/sync-cron.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { parseCrontab } from "../../scripts/sync-cron";
import { listAgents } from "../../lib/queries/agents";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-cron.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync-cron", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("parses crontab entries into agents", () => {
    const crontab = `# Comment
*/5 * * * * /usr/bin/python3 /opt/sync-projects.py
0 6 * * * /usr/bin/morning-forecast.sh`;
    parseCrontab(crontab);
    const agents = listAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].type).toBe("cron");
    expect(agents[0].schedule).toBeTruthy();
  });

  it("skips comment and empty lines", () => {
    const crontab = "# header\n\n# another comment\n";
    parseCrontab(crontab);
    expect(listAgents()).toHaveLength(0);
  });

  it("generates stable names from command", () => {
    const crontab = "*/5 * * * * /opt/sync-projects.py";
    parseCrontab(crontab);
    parseCrontab(crontab);
    expect(listAgents()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/scripts/sync-cron.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement `scripts/sync-cron.ts`**

```ts
import { execSync } from "child_process";
import path from "path";
import { upsertAgent } from "../lib/queries/agents";
import { recordSyncRun } from "../lib/queries/sync-status";
import { closeDb } from "../lib/db";

function deriveNameFromCommand(command: string): string {
  // Take the last path component, strip extension
  const parts = command.trim().split(/\s+/);
  const executable = parts.find((p) => p.includes("/")) ?? parts[0];
  const basename = path.basename(executable, path.extname(executable));
  return basename || command.substring(0, 40);
}

export function parseCrontab(crontab: string): void {
  const lines = crontab.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Crontab format: minute hour day month weekday command
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const schedule = parts.slice(0, 5).join(" ");
    const command = parts.slice(5).join(" ");
    const name = deriveNameFromCommand(command);

    upsertAgent({
      name,
      type: "cron",
      schedule,
      status: "running",
      config_path: command,
    });
  }
}

function main(): void {
  const start = Date.now();
  try {
    let crontab = "";
    try {
      crontab = execSync("crontab -l", { encoding: "utf-8" });
    } catch {
      crontab = ""; // no crontab installed
    }
    parseCrontab(crontab);
    recordSyncRun({ sync_name: "sync-cron", status: "ok", duration_ms: Date.now() - start });
    console.log(`sync-cron: ok (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncRun({ sync_name: "sync-cron", status: "error", error_message: msg, duration_ms: Date.now() - start });
    console.error(`sync-cron: error — ${msg}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/scripts/sync-cron.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Run against real crontab**

```bash
npm run sync:cron
```
Expected: "sync-cron: ok (Nms)". If no crontab exists, nothing is added — that's fine.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-cron.ts tests/scripts/sync-cron.test.ts
git commit -m "feat: sync-cron script parses crontab into agents"
```

---

### Task 20: Build sync-agents script

**Files:**
- Create: `scripts/sync-agents.ts`, `tests/scripts/sync-agents.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/scripts/sync-agents.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { scanAgentConfigDir } from "../../scripts/sync-agents";
import { listAgents } from "../../lib/queries/agents";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-agents.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync-agents", () => {
  let tmpDir: string;

  beforeEach(() => {
    initTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-agents-"));
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers an agent from a config file", () => {
    const configPath = path.join(tmpDir, "weather-bot.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        name: "WeatherBot",
        type: "discord_bot",
        schedule: "0 7 * * *",
        status: "running",
        last_output: "Des Moines 72F",
      })
    );

    scanAgentConfigDir(tmpDir);
    const agents = listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("WeatherBot");
    expect(agents[0].type).toBe("discord_bot");
    expect(agents[0].last_output).toBe("Des Moines 72F");
  });

  it("ignores non-json files", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "hello");
    scanAgentConfigDir(tmpDir);
    expect(listAgents()).toHaveLength(0);
  });

  it("handles empty directory gracefully", () => {
    scanAgentConfigDir(tmpDir);
    expect(listAgents()).toHaveLength(0);
  });

  it("handles missing directory gracefully", () => {
    scanAgentConfigDir(path.join(tmpDir, "does-not-exist"));
    expect(listAgents()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/scripts/sync-agents.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement `scripts/sync-agents.ts`**

```ts
import fs from "fs";
import path from "path";
import { upsertAgent } from "../lib/queries/agents";
import { recordSyncRun } from "../lib/queries/sync-status";
import { closeDb } from "../lib/db";
import type { AgentType, AgentStatus } from "../lib/types";

interface AgentConfig {
  name: string;
  type: AgentType;
  schedule?: string;
  host?: string;
  status?: AgentStatus;
  last_run_at?: string;
  last_output?: string;
}

export function scanAgentConfigDir(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const fullPath = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const config: AgentConfig = JSON.parse(raw);
      if (!config.name || !config.type) continue;
      upsertAgent({
        name: config.name,
        type: config.type,
        schedule: config.schedule,
        host: config.host ?? "mac_mini",
        status: config.status ?? "stopped",
        last_run_at: config.last_run_at,
        last_output: config.last_output,
        config_path: fullPath,
      });
    } catch (err) {
      console.warn(`sync-agents: failed to parse ${entry}: ${err}`);
    }
  }
}

function main(): void {
  const start = Date.now();
  const configDir = process.env.AGENT_CONFIG_DIR ?? path.join(process.env.HOME ?? "", ".dashboard", "agents");
  try {
    scanAgentConfigDir(configDir);
    recordSyncRun({ sync_name: "sync-agents", status: "ok", duration_ms: Date.now() - start });
    console.log(`sync-agents: ok (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncRun({ sync_name: "sync-agents", status: "error", error_message: msg, duration_ms: Date.now() - start });
    console.error(`sync-agents: error — ${msg}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/scripts/sync-agents.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Run against real agents directory**

```bash
npm run sync:agents
```
Expected: "sync-agents: ok (Nms)".

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-agents.ts tests/scripts/sync-agents.test.ts
git commit -m "feat: sync-agents script reads agent config directory"
```

---

## Phase 10: Integration & Docs

### Task 21: Run full integration check

**Files:** none (manual verification)

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected: All tests PASS (should be ~20+ tests).

- [ ] **Step 2: Reset DB and run full flow**

```bash
rm -f data/dashboard.db
npm run init-db
npm run sync:projects
npm run sync:cron
npm run sync:agents
```
Expected: All sync scripts succeed.

- [ ] **Step 3: Start dev server**

```bash
npm run dev
```

- [ ] **Step 4: Verify all pages load**

Visit each and confirm no errors:
- `http://localhost:3000/` — Dashboard with stats populated from synced data
- `http://localhost:3000/clients` — Empty state (or add a client via Settings first)
- `http://localhost:3000/agents` — Shows any agents/cron jobs synced
- `http://localhost:3000/files` — Empty state
- `http://localhost:3000/notes` — Empty state
- `http://localhost:3000/settings` — Add Client form works

- [ ] **Step 5: Verify client workflow end-to-end**

1. Go to Settings → add "Akoola" with stage "scripts delivered"
2. Verify Dashboard shows 1 client
3. Verify Clients page shows Akoola card
4. Click Akoola → Client Hub loads, no projects/files/notes yet
5. Go back to Clients → verify navigation works

- [ ] **Step 6: Commit any fixes**

If you discovered issues during integration testing, fix them and commit with a clear message:
```bash
git add -p
git commit -m "fix: <description of what was broken>"
```

If everything worked, no commit needed.

---

### Task 22: Write README with setup and deployment instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Command Center Dashboard

A unified dashboard for tracking clients, projects, agents, cron jobs, files, and notes. Hosted on the Mac Mini, accessible via Tailscale LAN.

## Quick Start (Local Dev)

```bash
npm install
npm run init-db
npm run dev
```

Open `http://localhost:3000`.

## Sync Scripts

Populate the database from local sources:

```bash
npm run sync:projects   # Scans ~/Work for git repos
npm run sync:cron       # Reads crontab into agents table
npm run sync:agents     # Reads ~/.dashboard/agents/*.json
```

### Environment Variables

- `WORK_DIR` — override the directory scanned by sync:projects (default: `~/Work`)
- `AGENT_CONFIG_DIR` — override where sync:agents looks (default: `~/.dashboard/agents`)

### Agent Config Format

Place JSON files at `~/.dashboard/agents/`:

```json
{
  "name": "WeatherBot",
  "type": "discord_bot",
  "schedule": "0 7 * * *",
  "status": "running",
  "last_output": "Des Moines — High 72F / Low 54F"
}
```

## Deploying to Mac Mini

1. Clone the repo to the Mac Mini:
   ```bash
   git clone <repo-url> ~/Dashboard
   cd ~/Dashboard
   npm install
   npm run init-db
   ```

2. Build for production:
   ```bash
   npm run build
   ```

3. Start the server (bind to Tailscale address):
   ```bash
   HOSTNAME=0.0.0.0 npm start
   ```

4. Add cron entries to keep data fresh:
   ```
   */5 * * * * cd ~/Dashboard && /usr/local/bin/node node_modules/.bin/tsx scripts/sync-projects.ts
   */15 * * * * cd ~/Dashboard && /usr/local/bin/node node_modules/.bin/tsx scripts/sync-cron.ts
   */5 * * * * cd ~/Dashboard && /usr/local/bin/node node_modules/.bin/tsx scripts/sync-agents.ts
   ```

5. Access from any Tailscale device:
   ```
   http://<mac-mini-tailscale-name>:3000
   ```

## Architecture

- **Data Layer**: SQLite (`data/dashboard.db`), populated by independent sync scripts
- **API Layer**: Next.js API routes in `app/api/`
- **UI Layer**: Next.js App Router pages in `app/`

See `docs/superpowers/specs/2026-04-11-command-center-dashboard-design.md` for the full design spec.

## Testing

```bash
npm test           # Run once
npm run test:watch # Watch mode
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and deployment instructions"
```

---

## Done

At this point the dashboard is fully functional for v1:

- All 7 pages render (Dashboard, Clients, Client Hub, Agents, Files, Notes, Settings)
- Collapsible sidebar with hover expansion
- Dark design system (JetBrains Mono + IBM Plex Sans, green/amber/red status)
- SQLite persistence with 7 tables
- 3 working sync scripts (projects, cron, agents)
- REST API for reading/writing data
- Client creation via Settings form
- Full test coverage on data and script layers
- README with deployment instructions

**Deferred to v2:**
- Notion / Google Drive / Discord / Apple Notes / Obsidian sync
- iPhone-responsive layout
- Action triggers (start/stop agents from UI)
- File content search
- Claude-queryable MCP server
