import { describe, it, expect, vi } from "vitest";
import { streamAnthropic } from "../../../lib/llm/anthropic";
import type { LlmMessage, LlmStreamChunk } from "../../../lib/llm/types";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streamAnthropic", () => {
  it("converts SDK deltas into text chunks and ends with done", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: " world" } };
        yield { type: "message_delta", usage: { output_tokens: 2 } };
        yield { type: "message_stop" };
      }
      return gen();
    });

    const fakeClient: { messages: { create: typeof mockCreate } } = {
      messages: { create: mockCreate },
    };

    const messages: LlmMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hi" },
    ];

    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages,
      model: "claude-opus-4-7",
      max_tokens: 1024,
    });

    const chunks = await collect(stream);
    const textOnly = chunks.filter((c): c is { type: "text"; text: string } => c.type === "text");
    const doneChunk = chunks.find((c) => c.type === "done");

    expect(textOnly.map((c) => c.text).join("")).toBe("Hello world");
    expect(doneChunk).toBeTruthy();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-7",
        stream: true,
        max_tokens: 1024,
        system: "system prompt",
        messages: [{ role: "user", content: "hi" }],
      })
    );
  });

  it("yields error chunk when SDK throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    const fakeClient = { messages: { create: mockCreate } };
    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages: [{ role: "user", content: "q" }],
      model: "claude-opus-4-7",
    });
    const chunks = await collect(stream) as LlmStreamChunk[];
    const err = chunks.find((c) => c.type === "error") as { type: "error"; status?: number; message: string } | undefined;
    expect(err).toBeTruthy();
    expect(err!.status).toBe(429);
    expect(err!.message).toContain("rate limited");
  });

  it("handles empty message list by including only system if present", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { type: "message_stop" };
      }
      return gen();
    });
    const fakeClient = { messages: { create: mockCreate } };
    const stream = streamAnthropic({
      client: fakeClient as unknown as import("@anthropic-ai/sdk").default,
      messages: [{ role: "system", content: "s" }],
      model: "claude-opus-4-7",
    });
    await collect(stream);
    expect(mockCreate.mock.calls[0][0].messages).toEqual([]);
  });
});
