import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, migrate } from "../../lib/db";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-db-migrate.db");
const MIG_DIR = path.join(process.cwd(), "data", "test-migrations-tmp");

function setupMigrationsDir(files: Record<string, string>): void {
  if (fs.existsSync(MIG_DIR)) fs.rmSync(MIG_DIR, { recursive: true });
  fs.mkdirSync(MIG_DIR, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(MIG_DIR, name), sql);
  }
}

describe("migrate", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(MIG_DIR)) fs.rmSync(MIG_DIR, { recursive: true });
  });

  it("runs unrun migrations and bumps user_version", () => {
    setupMigrationsDir({
      "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);",
      "002-bar.sql": "CREATE TABLE bar (id TEXT PRIMARY KEY);",
    });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  it("is idempotent — second run is a no-op", () => {
    setupMigrationsDir({ "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);" });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("rolls back a failing migration without bumping user_version", () => {
    setupMigrationsDir({ "001-bad.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY); SELECT bogus_function();" });
    const db = resetDbForTesting(TEST_DB);
    expect(() => migrate(db, MIG_DIR)).toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'").all();
    expect(tables.length).toBe(0);
  });

  it("ignores files that don't match NNN-name.sql pattern", () => {
    setupMigrationsDir({
      "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);",
      "README.md": "noise",
      "no-number.sql": "CREATE TABLE noise (id TEXT PRIMARY KEY);",
    });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).not.toContain("noise");
  });

  it("skips already-applied migrations and applies only new ones", () => {
    setupMigrationsDir({ "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);" });
    const db = resetDbForTesting(TEST_DB);
    migrate(db, MIG_DIR);
    expect(db.pragma("user_version", { simple: true })).toBe(1);

    setupMigrationsDir({
      "001-foo.sql": "CREATE TABLE foo (id TEXT PRIMARY KEY);",
      "002-bar.sql": "CREATE TABLE bar (id TEXT PRIMARY KEY);",
    });
    // If 001 were re-executed, it would throw "table foo already exists".
    expect(() => migrate(db, MIG_DIR)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });
});
