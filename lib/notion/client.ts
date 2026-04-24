import { Client } from "@notionhq/client";
import type { NotionBlock } from "./blocks-to-markdown";

const MIN_GAP_MS = 400; // ~2.5 req/s
const MAX_RETRIES = 5;
const MAX_BLOCK_DEPTH = 10;

export interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  created_time: string;
  properties: Record<string, unknown>;
  archived: boolean;
}

/**
 * Inline rate limiter — chains calls via a single Promise queue, enforcing a
 * minimum gap between request starts. No external dep (p-limit is ESM-only).
 */
class RateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  constructor(private minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const delta = Date.now() - this.lastAt;
      if (delta < this.minGapMs) {
        await new Promise((r) => setTimeout(r, this.minGapMs - delta));
      }
      this.lastAt = Date.now();
      return fn();
    });
    // Keep the chain alive regardless of success/failure so later callers still wait.
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result as Promise<T>;
  }
}

export class NotionClient {
  private client: Client;
  private rl = new RateLimiter(MIN_GAP_MS);

  constructor(token: string) {
    this.client = new Client({ auth: token, notionVersion: "2026-03-11" });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.rl.run(async () => {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err: unknown) {
          const e = err as { code?: string; status?: number };
          const is429 = e.status === 429 || e.code === "rate_limited";
          if (!is429 || attempt >= MAX_RETRIES) throw err;
          const backoff = Math.min(60_000, 1000 * 2 ** attempt);
          await new Promise((r) => setTimeout(r, backoff));
          attempt += 1;
        }
      }
    });
  }

  async getPage(page_id: string): Promise<NotionPage> {
    const res = (await this.call(() => this.client.pages.retrieve({ page_id }))) as NotionPage;
    return res;
  }

  async getBlocks(block_id: string, depth = 0): Promise<NotionBlock[]> {
    if (depth > MAX_BLOCK_DEPTH) {
      console.warn(`[notion] block tree exceeded MAX_BLOCK_DEPTH (${MAX_BLOCK_DEPTH}) at ${block_id}; truncating`);
      return [];
    }
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      const res = (await this.call(() =>
        this.client.blocks.children.list({ block_id, start_cursor: cursor, page_size: 100 })
      )) as { results: NotionBlock[]; has_more: boolean; next_cursor: string | null };
      out.push(...res.results);
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);

    // Recursively fetch children for blocks with has_children, up to MAX_BLOCK_DEPTH
    for (const block of out) {
      if (block.has_children) {
        block.children = await this.getBlocks(block.id, depth + 1);
      }
    }
    return out;
  }
}

export function extractPageTitle(page: NotionPage): string {
  // Pages typically have a "title" property in their properties map.
  for (const [, prop] of Object.entries(page.properties)) {
    const p = prop as { type?: string; title?: { plain_text: string }[] };
    if (p.type === "title" && p.title) {
      const joined = p.title.map((t) => t.plain_text).join("").trim();
      if (joined) return joined;
    }
  }
  return page.id;
}
