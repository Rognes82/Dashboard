import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createClient } from "../../../lib/queries/clients";
import { upsertProject, listProjects, listProjectsByClient, setProjectClient, getProjectById } from "../../../lib/queries/projects";
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

  it("setProjectClient assigns an unassigned project", () => {
    const client = createClient({ name: "Akoola" });
    const project = upsertProject({ client_id: null, name: "Orphan", path: "/o", branch: "main" });
    const updated = setProjectClient(project.id, client.id);
    expect(updated?.client_id).toBe(client.id);
  });

  it("setProjectClient unassigns by passing null", () => {
    const client = createClient({ name: "Akoola" });
    const project = upsertProject({ client_id: client.id, name: "P", path: "/p", branch: "main" });
    const updated = setProjectClient(project.id, null);
    expect(updated?.client_id).toBeNull();
  });

  it("getProjectById returns null for missing", () => {
    expect(getProjectById("nonexistent")).toBeNull();
  });
});
