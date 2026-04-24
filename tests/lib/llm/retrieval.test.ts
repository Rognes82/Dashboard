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
