import { describe, it, expect } from "vitest";
import { newId, nowIso, slugify, formatRelativeTime } from "../../lib/utils";

describe("utils", () => {
  it("newId returns a 26-char ULID", () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("nowIso returns ISO 8601 string", () => {
    const now = nowIso();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("slugify lowercases and hyphenates", () => {
    expect(slugify("Akoola Media")).toBe("akoola-media");
    expect(slugify("  Synergy  Contracting!  ")).toBe("synergy-contracting");
  });

  it("formatRelativeTime returns 'just now' for <60s", () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("just now");
  });

  it("formatRelativeTime returns 'Xm ago' for minutes", () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(d.toISOString())).toBe("5m ago");
  });

  it("formatRelativeTime returns 'Xh ago' for hours", () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(d.toISOString())).toBe("3h ago");
  });
});
