import { describe, it, expect, vi } from "vitest";
import { streamOpenAiCompat } from "../../../lib/llm/openai-compat";
import type { LlmMessage, LlmStreamChunk } from "../../../lib/llm/types";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streamOpenAiCompat", () => {
  it("converts chunk deltas to text and ends with done", async () => {
    const mockCreate = vi.fn().mockImplementation(async () => {
      async function* gen() {
        yield { choices: [{ delta: { content: "Hello" } }] };
        yield { choices: [{ delta: { content: " world" } }] };
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
      }
      return gen();
    });
    const fakeClient = { chat: { completions: { create: mockCreate } } };
    const messages: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "q" },
    ];
    const chunks = await collect(
      streamOpenAiCompat({
        client: fakeClient as unknown as import("openai").OpenAI,
        messages,
        model: "moonshotai/kimi-k2",
      })
    );
    const text = chunks
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("Hello world");
    expect(chunks.at(-1)).toMatchObject({ type: "done" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "moonshotai/kimi-k2",
        stream: true,
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "q" },
        ],
      })
    );
  });

  it("yields error chunk on SDK failure", async () => {
    const mockCreate = vi.fn().mockRejectedValue(Object.assign(new Error("invalid key"), { status: 401 }));
    const fakeClient = { chat: { completions: { create: mockCreate } } };
    const chunks = (await collect(
      streamOpenAiCompat({
        client: fakeClient as unknown as import("openai").OpenAI,
        messages: [{ role: "user", content: "q" }],
        model: "x",
      })
    )) as LlmStreamChunk[];
    const err = chunks.find((c) => c.type === "error") as
      | { type: "error"; status?: number; message: string }
      | undefined;
    expect(err).toBeTruthy();
    expect(err!.status).toBe(401);
  });
});
