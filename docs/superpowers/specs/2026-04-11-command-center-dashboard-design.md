# Command Center Dashboard — Design Spec

## Overview

A web-based command center that unifies client/project tracking, agent/automation monitoring, file storage, and notes into a single dashboard. Hosted on the Mac Mini, accessible via Tailscale LAN from MacBook, iPhone, and other devices.

## Problem

Information is scattered across multiple systems and machines:
- Client work tracked loosely across Notion, local files, and memory
- Agents and cron jobs run on the Mac Mini with no visibility into status or output
- Files split between Google Drive, local directories on multiple machines
- Notes fragmented across Notion, Apple Notes, and potentially Obsidian
- Discord bots post output with no centralized view
- No single place to see what's happening, what's running, or what needs attention

## Solution

A Next.js + SQLite dashboard that syncs data from all sources into one database and presents it through a clean, dark-mode command center UI.

## Architecture

### Three Layers

```
┌──────────────────────────────────────────────┐
│                  UI Layer                     │
│         Next.js React Frontend                │
│    (Dashboard, Clients, Agents, Files, Notes) │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│                 API Layer                     │
│           Next.js API Routes                  │
│   /api/clients, /api/system, /api/files, etc  │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│                Data Layer                     │
│              SQLite Database                  │
│     ← populated by independent sync scripts   │
└──────────────────────────────────────────────┘
```

### Sync Scripts

Each sync script is independent — runs on its own cron schedule, pulls from one source, writes to SQLite. If one breaks, the others keep working.

| Script | Source | Frequency | What It Does |
|--------|--------|-----------|-------------|
| `sync-projects.ts` | Local filesystem + git | Every 5 min | Crawls ~/Work directory, reads git status, recent commits, branch info |
| `sync-notion.ts` | Notion API | Every 15 min | Pulls pages and databases, extracts content previews |
| `sync-discord.ts` | Discord webhook logs / bot output | Every 30 min | Reads bot output files, captures latest posts |
| `sync-cron.ts` | crontab + log files | Every 5 min | Parses crontab, reads job logs for last run time and status |
| `sync-drive.ts` | Google Drive API | Every 15 min | Indexes file names, links, modified dates from client folders |
| `sync-agents.ts` | Agent config/output dirs | Every 5 min | Reads agent configs, checks process status, captures output |

### Hosting & Access

- **Develop** on MacBook, push via git
- **Run** on Mac Mini — always-on server
- **Access** from any Tailscale device (MacBook, iPhone, Mac Mini itself)
- **No auth layer** for v1 — Tailscale is the trust boundary

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript (everywhere) |
| Database | SQLite (via better-sqlite3) |
| Styling | Tailwind CSS |
| Icons | Lucide React (SVG) |
| Fonts | JetBrains Mono (headings/data), IBM Plex Sans (body/UI) |
| Sync runtime | Node.js scripts executed via cron |
| Hosting | Node.js on Mac Mini |

## Data Model

### `clients`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| name | TEXT | Client name (e.g., "Akoola") |
| slug | TEXT | URL-safe identifier |
| status | TEXT | active / paused / completed |
| pipeline_stage | TEXT | Free-text stage (e.g., "scripts delivered") |
| notes | TEXT | Internal notes about the client |
| created_at | TEXT (ISO 8601) | When the client was added |
| updated_at | TEXT (ISO 8601) | Last modification |

### `projects`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| client_id | TEXT | FK → clients.id |
| name | TEXT | Project name |
| path | TEXT | Local directory path |
| repo_url | TEXT | Git remote URL (if applicable) |
| branch | TEXT | Current branch |
| last_commit_at | TEXT | Timestamp of most recent commit |
| last_commit_message | TEXT | Message of most recent commit |
| status | TEXT | active / inactive |

### `files`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| client_id | TEXT | FK → clients.id (nullable) |
| project_id | TEXT | FK → projects.id (nullable) |
| name | TEXT | File name |
| path | TEXT | Full path or Drive path |
| source | TEXT | local / gdrive / notion |
| source_url | TEXT | Link to open the file in its source |
| file_type | TEXT | Extension or MIME type |
| size | INTEGER | Bytes |
| modified_at | TEXT | Last modification timestamp |

### `notes`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| client_id | TEXT | FK → clients.id (nullable) |
| title | TEXT | Note title |
| content_preview | TEXT | First ~500 characters |
| source | TEXT | notion / apple_notes / obsidian |
| source_url | TEXT | Link to open in source app |
| tags | TEXT | Comma-separated tags |
| modified_at | TEXT | Last modification timestamp |

### `agents`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| name | TEXT | Agent/bot name |
| type | TEXT | cron / discord_bot / daemon / script / manual |
| schedule | TEXT | Cron expression (if applicable) |
| host | TEXT | mac_mini / macbook |
| status | TEXT | running / stopped / errored |
| last_run_at | TEXT | When it last executed |
| last_output | TEXT | Most recent output (truncated) |
| config_path | TEXT | Path to agent config/script |

### `activity`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (ULID) | Primary key |
| client_id | TEXT | FK → clients.id (nullable) |
| agent_id | TEXT | FK → agents.id (nullable) |
| source | TEXT | git / notion / gdrive / discord / system / files |
| event_type | TEXT | commit / file_change / note_update / agent_run / bot_output / sync_error |
| title | TEXT | Short description of the event |
| detail | TEXT | Additional context |
| timestamp | TEXT | When it happened |

### `sync_status`

One row per sync script, upserted on each run.

| Column | Type | Description |
|--------|------|-------------|
| sync_name | TEXT | Primary key (e.g., "sync-projects") |
| last_run_at | TEXT | When it last ran |
| status | TEXT | ok / error |
| error_message | TEXT | Error details (if applicable) |
| duration_ms | INTEGER | How long the sync took |

### Relationships

- A **client** has many **projects**, **files**, **notes**, and **activity** entries
- An **agent** generates **activity** entries when it runs
- **Files** can belong to a client, a project, or neither (unassociated)
- **Notes** can be client-linked or standalone
- **Activity** is the unified timeline that ties everything together

## Design System

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| bg-base | #0a0a0a | Page background |
| bg-card | #111111 | Card/surface background |
| bg-hover | #1a1a1a | Hover states, nested surfaces |
| border | #222222 | Card borders, dividers |
| text-primary | #f5f5f5 | Headings, primary content |
| text-secondary | #888888 | Labels, timestamps, secondary info |
| text-muted | #555555 | Decorative text, tertiary info |
| accent-green | #4ade80 | Healthy, active, success, primary accent |
| accent-amber | #facc15 | Warning, stale, attention needed |
| accent-red | #ef4444 | Error, failed, critical |

### Typography

| Role | Font | Weight | Sizes |
|------|------|--------|-------|
| Headings, data values, monospace | JetBrains Mono | 400, 500, 600 | 14, 18, 24, 32 |
| Body, UI labels, descriptions | IBM Plex Sans | 400, 500, 600 | 10, 11, 12, 14, 16 |

- Type scale: 10 / 11 / 12 / 14 / 16 / 18 / 24 / 32
- Line height: 1.5 for body text
- Tabular figures for data columns (font-variant-numeric: tabular-nums)

### Spacing

4/8px system: 4, 8, 12, 16, 24, 32, 48

### Border Radius

- Cards: 6px
- Inputs, badges, small elements: 4px
- Buttons: 6px

### Effects

- No box-shadows on dark backgrounds — use 1px solid #222 borders for elevation
- Modals only: backdrop-filter: blur(8px)
- Transitions: 200ms ease-out for micro-interactions

### Icons

- Lucide React (SVG, consistent stroke width)
- 16px default, 14px in compact contexts
- No emoji as icons

## Pages

### 1. Dashboard (Home)

The default view. Shows:
- **Stat cards row** — 4 cards: Clients (count + active), Agents (count + running), Cron Jobs (count + warnings), Files (count + indexed)
- **Client Pipeline** — List of all clients with status dot and pipeline stage badge
- **Recent Activity** — Unified timeline with colored left border, source label, relative timestamp

### 2. Clients List

- Grid or list of all clients with avatar initial, name, status, pipeline stage
- Click to drill into client hub

### 3. Client Hub (Drill-Down)

- **Breadcrumb**: Clients / [Client Name]
- **Header**: Avatar initial, name, status badge, context line (client since, business)
- **Tab bar**: Overview | Files | Notes | Activity
- **Overview tab** (default): 2x2 grid of:
  - Projects — all repos with branch, commit info, activity dot
  - Recent Files — across all sources with source label
  - Notes — content previews with source badge
  - Activity — client-scoped timeline
- **Files tab**: Full file list for this client, filterable by source
- **Notes tab**: All notes linked to this client
- **Activity tab**: Full activity history for this client

### 4. Agents & System

- **Agents** — List with name, type (cron/daemon/manual), schedule, last run, status dot
- **Discord Bots** — Online status, channel, expandable output box showing latest post
- **Cron Jobs** — Table with job name, cron expression, last run, status
- **Sync Health** — Progress bars per data source (green = ok, amber = stale)

### 5. Files

- Cross-client file browser
- Filterable by source (local/gdrive/notion), client, file type
- Shows file name, source, client, modified date
- Links to open file in source (Drive link, local path, Notion URL)

### 6. Notes

- Aggregated notes from all sources
- Filterable by source (Notion/Apple Notes/Obsidian), client, tags
- Content preview with source badge
- Links to open in source app

### 7. Settings

- Client management (add/edit/archive)
- Pipeline stage configuration
- Sync script config (which directories to watch, API keys, schedules)
- System info (Mac Mini status, Tailscale IP, disk usage)

## Navigation

Collapsible sidebar:
- **Collapsed** (default): 56px wide, icons only, sync dots centered at bottom
- **Expanded** (on hover): 220px wide, icons + labels, logo text, sync text
- **Transition**: 200ms ease-out, sidebar overlays (main content does not shift)
- **Nav items**: Dashboard, Clients, Agents, Files, Notes, Settings
- **Footer**: Sync health dots + "Synced Xm ago" text

## Claude Integration

The dashboard does not include a built-in chat interface. Instead:
- All data is structured in SQLite, queryable by Claude Code
- When you need to ask questions or create things from the data, open Claude Code in a terminal
- Claude can read the database, understand client status, find files, check agent output
- Future: a CLAUDE.md in this project that teaches Claude how to query the dashboard DB

## V1 Scope

### Included

- Next.js app with all 7 pages
- SQLite database with all tables
- Sync scripts: sync-projects, sync-cron, sync-agents
- Manual client/project data entry via Settings page
- Collapsible sidebar navigation
- Full design system implementation

### Deferred to V2+

- Notion API sync (requires API key setup)
- Google Drive API sync (requires OAuth setup)
- Discord bot log sync (requires bot config)
- Apple Notes sync (requires macOS scripting bridge)
- Obsidian sync (requires vault path config)
- iPhone-optimized responsive layout
- Push notifications / alerts
- Action triggers from the dashboard (start/stop agents, run scripts)
- File content search
- Claude-queryable API or MCP server

## V1 Sync Scripts (What Ships)

These three syncs can work immediately with zero external API setup:

1. **sync-projects.ts** — Scans local ~/Work directories, reads git status/log
2. **sync-cron.ts** — Parses crontab, reads system logs for job execution history
3. **sync-agents.ts** — Reads agent config directories, checks process status

Everything else (Notion, Drive, Discord, Apple Notes, Obsidian) is wired into the UI but shows "Not configured" until the relevant API keys / paths are set up in Settings.
