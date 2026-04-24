import { OpenAI } from "openai";
import type { LlmMessage, LlmStreamChunk } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

interface StreamOptions {
  client: OpenAI;
  messages: LlmMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export function makeOpenAiCompatClient(api_key: string, base_url: string): OpenAI {
  return new OpenAI({ apiKey: api_key, baseURL: base_url });
}

export async function* streamOpenAiCompat(opts: StreamOptions): AsyncIterable<LlmStreamChunk> {
  try {
    const stream = await opts.client.chat.completions.create({
      model: opts.model,
      stream: true,
      max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);

    let usage: { input_tokens?: number; output_tokens?: number } | undefined;

    for await (const chunk of stream as AsyncIterable<{
      choices: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: "text", text: delta.content };
      }
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens,
          output_tokens: chunk.usage.completion_tokens,
        };
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
