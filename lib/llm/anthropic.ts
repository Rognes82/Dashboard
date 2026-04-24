import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage, LlmStreamChunk } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

interface StreamOptions {
  client: Anthropic;
  messages: LlmMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export function makeAnthropicClient(api_key: string): Anthropic {
  return new Anthropic({ apiKey: api_key });
}

export async function* streamAnthropic(opts: StreamOptions): AsyncIterable<LlmStreamChunk> {
  const systemMsg = opts.messages.find((m) => m.role === "system");
  const nonSystem = opts.messages.filter((m) => m.role !== "system");

  try {
    const stream = await opts.client.messages.create({
      model: opts.model,
      stream: true,
      max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      system: systemMsg?.content,
      messages: nonSystem.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    } as Parameters<Anthropic["messages"]["create"]>[0]);

    let usage: { input_tokens?: number; output_tokens?: number } | undefined;

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const t = event.type as string;
      if (t === "content_block_delta") {
        const delta = event.delta as { type?: string; text?: string };
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text", text: delta.text };
        }
      } else if (t === "message_delta") {
        const u = event.usage as { output_tokens?: number } | undefined;
        if (u) usage = { ...(usage ?? {}), output_tokens: u.output_tokens };
      } else if (t === "message_start") {
        const msg = (event.message as { usage?: { input_tokens?: number } }) ?? {};
        if (msg.usage) usage = { ...(usage ?? {}), input_tokens: msg.usage.input_tokens };
      }
    }
    yield { type: "done", usage };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    yield {
      type: "error",
      status: e.status,
      message: e.message ?? String(err),
    };
  }
}
