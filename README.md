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
