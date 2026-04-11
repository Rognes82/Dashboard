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
