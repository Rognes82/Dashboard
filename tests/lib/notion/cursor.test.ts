import { describe, it, expect } from "vitest";
import { parseCursor, serializeCursor, updateCursor, getDbCursor } from "../../../lib/notion/cursor";

describe("notion cursor", () => {
  it("parseCursor returns empty map for null/missing", () => {
    expect(parseCursor(null)).toEqual({});
    expect(parseCursor(undefined as unknown as string)).toEqual({});
  });

  it("parseCursor returns map for valid JSON object", () => {
    expect(parseCursor('{"db1":"2026-04-23T10:00:00Z"}')).toEqual({
      db1: "2026-04-23T10:00:00Z",
    });
  });

  it("parseCursor returns empty map for malformed JSON", () => {
    expect(parseCursor("not-json")).toEqual({});
  });

  it("parseCursor returns empty map for non-object (array, string, number)", () => {
    expect(parseCursor('["db1"]')).toEqual({});
    expect(parseCursor('"raw"')).toEqual({});
    expect(parseCursor("42")).toEqual({});
  });

  it("serializeCursor round-trips", () => {
    const m = { db1: "2026-04-23T10:00:00Z", db2: "2026-04-24T00:00:00Z" };
    expect(parseCursor(serializeCursor(m))).toEqual(m);
  });

  it("updateCursor sets one entry without touching others", () => {
    const m = { db1: "2026-04-23T10:00:00Z" };
    expect(updateCursor(m, "db2", "2026-04-24T12:00:00Z")).toEqual({
      db1: "2026-04-23T10:00:00Z",
      db2: "2026-04-24T12:00:00Z",
    });
  });

  it("getDbCursor returns timestamp for known db, undefined for unknown", () => {
    const m = { db1: "2026-04-23T10:00:00Z" };
    expect(getDbCursor(m, "db1")).toBe("2026-04-23T10:00:00Z");
    expect(getDbCursor(m, "db2")).toBeUndefined();
  });
});
