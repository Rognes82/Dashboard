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
