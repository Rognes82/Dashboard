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

## Running as a launchd service (recommended)

Rather than leaving `npm start` in a terminal, register a launchd agent so the dashboard starts on login and restarts on crash. Save as `~/Library/LaunchAgents/com.local.dashboard.plist` (adjust paths/user):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.local.dashboard</string>
  <key>WorkingDirectory</key> <string>/Users/YOU/Dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npm</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOSTNAME</key> <string>0.0.0.0</string>
    <key>PORT</key>     <string>3000</string>
    <key>PATH</key>     <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>      <true/>
  <key>KeepAlive</key>      <true/>
  <key>StandardOutPath</key><string>/tmp/dashboard.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/dashboard.err.log</string>
</dict>
</plist>
```

Load it: `launchctl load ~/Library/LaunchAgents/com.local.dashboard.plist`.

## Backups

The SQLite database lives at `data/dashboard.db`. Add a daily backup cron entry:

```
0 3 * * * cp ~/Dashboard/data/dashboard.db ~/Dashboard/data/backups/dashboard-$(date +\%Y\%m\%d).db
```

Keep `data/backups/` gitignored and prune with a retention policy of your choice.

## Security

There is **no authentication** on the app or API routes. This is acceptable only because the intended deploy binds to the Tailscale LAN. **Do not** expose port 3000 to the public internet. If that ever changes, add an auth proxy (Cloudflare Access, Tailscale Serve with ACLs, or a simple shared-secret middleware) in front of Next.js.

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

## Auto-classifier (v1.3)

The dashboard runs a classifier that places uncategorized notes into bins automatically.

**How it works.** Every cron tick (default: 10 min) the classifier reads notes that have no bin assignments, asks the LLM to pick a best-fit bin from your existing tree, and either auto-assigns (when confidence ≥ 0.6) or queues a proposal in `/review`. New bins can be auto-created when the agent rates them ≥ 0.75 AND meaningfully better than the closest existing bin.

**Settings.** Configure under Settings → Classifier:
- `Profile`: which LLM profile to use (Haiku, Kimi, etc.). Falls back to active chat profile if unset.
- `Cron interval`: minutes between automatic runs.
- `Rate limit`: requests/minute (default 45 — under Anthropic tier-1's 50 RPM cap).
- `Thresholds`: tune the auto-assign confidence and auto-create rating + margin gates.

**Running on demand.** Click `Run classifier now` in `/review` after a big sync, or run `npm run classify` from the CLI.

**Per-note control.**
- Frontmatter `bins:` (plural array) on a note pre-assigns it AND tells the classifier to skip that note forever.
- "Stop trying" button on any pending proposal flips the same flag.
- 3 rejected proposals on the same note auto-flip the flag.

**Disabling the classifier.** Clear the classify profile in Settings (set to `(falls back to active chat profile)` and also clear your active chat profile), or set `classify.cron_interval_min = 0` and don't trigger manually.

### Manual smoke walkthrough

Performed by the user, not automated. After deploying:

1. Reset DB to clean state OR migrate an existing one:
   `rm data/dashboard.db && npm run init-db` (or keep existing — migrate runs automatically)
2. Seed bins via the UI: create at least 3 top-level bins with known content focus.
3. Drop 5+ unbinned notes into the vault (e.g., manually create captures/foo.md files,
   sync a few Notion pages, etc.) and run `npm run sync:vault` to index.
4. Open `/review`. Pending Proposals + Recently Auto-Classified should be empty;
   Last run summary shows "never run yet".
5. Click "Run classifier now". Verify:
   - Toast shows summary
   - Both cards populate
   - Auto-assigned notes appear with their assigned bin in /bins
6. Right-click → reject one proposal. Verify it disappears and re-queues on next run.
7. Reject the same note's proposal 3x. Verify `classifier_skip` flips and the note
   no longer reappears in pending after manual runs.
8. Trigger an auto-create scenario: write a note with content that doesn't fit any
   existing bin, but with a clearly correct new-bin path. Verify a new bin is
   created with the note in it.
9. Click Undo on the auto-created assignment. Verify:
   - Assignment removed
   - Auto-created bin deleted (since now empty)
   - Note returns to uncategorized state
10. Add `bins: ["travel"]` to a note's frontmatter, save, run `npm run sync:vault`.
    Verify `classifier_skip = 1` in the DB AND the bin assignment was applied.
11. Concurrent-run guard: open two terminals; in one, run `npm run classify`; in the
    other, click "Run classifier now" while the first is still running. Verify the
    second gets a 409 / "already in flight" toast.
12. Tune thresholds in Settings (e.g. `existing_min = 0.8`). Verify next run
    queues more notes as pending.
