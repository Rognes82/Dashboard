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
      return;
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

if (require.main === module) {
  main();
}
