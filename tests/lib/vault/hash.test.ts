import { describe, it, expect } from "vitest";
import { hashContent } from "../../../lib/vault/hash";

describe("hashContent", () => {
  it("returns a stable hex string for the same input", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("handles empty input", () => {
    expect(hashContent("")).toMatch(/^[0-9a-f]+$/);
  });

  it("handles unicode", () => {
    expect(hashContent("hello 🎉")).not.toBe(hashContent("hello"));
  });
});
