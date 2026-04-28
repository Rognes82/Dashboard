export interface RateLimiterConfig {
  rpm: number;
  windowMs?: number;
}

export function createRateLimiter(config: RateLimiterConfig): () => Promise<void> {
  const windowMs = config.windowMs ?? 60_000;
  const capacity = config.rpm;
  let tokens = capacity;
  let lastRefillAt = Date.now();
  const queue: (() => void)[] = [];

  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefillAt;
    if (elapsed >= windowMs) {
      tokens = capacity;
      lastRefillAt = now;
      return;
    }
    const refillAmount = Math.floor((elapsed / windowMs) * capacity);
    if (refillAmount > 0) {
      tokens = Math.min(capacity, tokens + refillAmount);
      lastRefillAt = now;
    }
  }

  function tryDrain(): void {
    refill();
    while (tokens > 0 && queue.length > 0) {
      tokens -= 1;
      const next = queue.shift()!;
      next();
    }
    if (queue.length > 0) {
      const msPerToken = windowMs / capacity;
      setTimeout(tryDrain, Math.max(10, msPerToken));
    }
  }

  return function acquire(): Promise<void> {
    return new Promise((resolve) => {
      queue.push(resolve);
      tryDrain();
    });
  };
}
