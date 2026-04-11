import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createClient, listClients, getClientBySlug, updateClientStatus } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-clients.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("clients queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("createClient inserts and returns the client", () => {
    const client = createClient({ name: "Akoola", pipeline_stage: "scripts delivered" });
    expect(client.name).toBe("Akoola");
    expect(client.slug).toBe("akoola");
    expect(client.status).toBe("active");
    expect(client.id).toHaveLength(26);
  });

  it("listClients returns all clients ordered by name", () => {
    createClient({ name: "Zeta" });
    createClient({ name: "Alpha" });
    const clients = listClients();
    expect(clients).toHaveLength(2);
    expect(clients[0].name).toBe("Alpha");
  });

  it("getClientBySlug returns the matching client", () => {
    createClient({ name: "Akoola" });
    const client = getClientBySlug("akoola");
    expect(client?.name).toBe("Akoola");
  });

  it("getClientBySlug returns null for missing", () => {
    expect(getClientBySlug("nope")).toBeNull();
  });

  it("updateClientStatus changes status and pipeline_stage", () => {
    const client = createClient({ name: "Akoola" });
    const updated = updateClientStatus(client.id, "paused", "on hold");
    expect(updated?.status).toBe("paused");
    expect(updated?.pipeline_stage).toBe("on hold");
  });
});
