import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../../lib/classify/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit immediately", async () => {
    const acquire = createRateLimiter({ rpm: 60, windowMs: 1000 });
    const start = Date.now();
    await Promise.all([acquire(), acquire(), acquire()]);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("delays the request that exceeds the bucket", async () => {
    // 2 RPM over a 300ms window → 1 token refills every 150ms.
    // After draining the initial 2 tokens, the 3rd must wait ≥80ms (jitter-tolerant)
    // before a refill makes one available.
    const acquire = createRateLimiter({ rpm: 2, windowMs: 300 });
    await acquire();
    await acquire();
    const start = Date.now();
    await acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("refills tokens over time", async () => {
    const acquire = createRateLimiter({ rpm: 4, windowMs: 200 });
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    await new Promise((r) => setTimeout(r, 220));
    const start = Date.now();
    await acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
