import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, migrate } from "../../lib/db";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-mig-001.db");

function loadBaselineSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
}

describe("migration 001-classifier", () => {
  beforeEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("creates new tables and adds columns to vault_notes", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("classification_proposals");
    expect(names).toContain("classification_log");
    expect(names).toContain("classifier_runs");

    const cols = db.prepare("PRAGMA table_info(vault_notes)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("classifier_skip");
    expect(colNames).toContain("classifier_attempts");
  });

  it("default values on new vault_notes columns are 0", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);

    db.prepare(
      "INSERT INTO vault_notes (id, vault_path, title, source, content_hash, modified_at, last_indexed_at, created_at) VALUES ('n1', 'a.md', 'A', 'obsidian', 'h', '2026-01-01', '2026-01-01', '2026-01-01')"
    ).run();
    const row = db.prepare("SELECT classifier_skip, classifier_attempts FROM vault_notes WHERE id = 'n1'").get() as {
      classifier_skip: number;
      classifier_attempts: number;
    };
    expect(row.classifier_skip).toBe(0);
    expect(row.classifier_attempts).toBe(0);
  });

  it("is idempotent — running twice is a no-op", () => {
    const db = resetDbForTesting(TEST_DB);
    db.exec(loadBaselineSchema());
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });
});
