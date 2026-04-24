import { describe, it, expect } from "vitest";
import { captureSlug, captureFilename } from "../../../lib/capture/slug";

describe("captureSlug", () => {
  it("takes first 5 words, lowercased and hyphenated", () => {
    expect(captureSlug("Tokyo reel idea for the content series")).toBe("tokyo-reel-idea-for-the");
  });

  it("strips non-alphanumerics", () => {
    expect(captureSlug("Hey! I'm testing: #tags & stuff.")).toBe("hey-im-testing-tags-stuff");
  });

  it("falls back to 'capture' when input has fewer than 3 words", () => {
    expect(captureSlug("hi")).toBe("capture");
    expect(captureSlug("")).toBe("capture");
    expect(captureSlug("   ")).toBe("capture");
  });

  it("collapses multiple spaces/newlines", () => {
    expect(captureSlug("alpha\n\nbeta   gamma\tdelta epsilon zeta")).toBe("alpha-beta-gamma-delta-epsilon");
  });

  it("strips unicode gracefully (emoji, accents)", () => {
    expect(captureSlug("café olé 🎉 paris dreams")).toBe("caf-ol-paris-dreams");
  });
});

describe("captureFilename", () => {
  it("formats <YYYY-MM-DD-HH-MM>-<slug>.md", () => {
    const ts = new Date("2026-04-24T14:32:00Z");
    expect(captureFilename(ts, "tokyo-reel-idea-for-the")).toBe("2026-04-24-14-32-tokyo-reel-idea-for-the.md");
  });

  it("pads minutes and hours", () => {
    const ts = new Date("2026-04-24T03:05:00Z");
    expect(captureFilename(ts, "short")).toBe("2026-04-24-03-05-short.md");
  });
});
