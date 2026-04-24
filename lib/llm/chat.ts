import { makeAnthropicClient, streamAnthropic } from "./anthropic";
import { makeOpenAiCompatClient, streamOpenAiCompat } from "./openai-compat";
import { getProfileSecret } from "./profiles";
import type { LlmMessage, LlmProfile, LlmStreamChunk } from "./types";

interface StreamChatOptions {
  profile: LlmProfile;
  messages: LlmMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export async function* streamChatForProfile(
  opts: StreamChatOptions
): AsyncIterable<LlmStreamChunk> {
  const secret = getProfileSecret(opts.profile.id);
  const model = opts.model ?? opts.profile.default_model;

  if (opts.profile.type === "anthropic") {
    const client = makeAnthropicClient(secret);
    yield* streamAnthropic({
      client,
      messages: opts.messages,
      model,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    });
    return;
  }

  if (opts.profile.type === "openai-compatible") {
    if (!opts.profile.base_url) {
      throw new Error("openai-compatible profile requires base_url");
    }
    const client = makeOpenAiCompatClient(secret, opts.profile.base_url);
    yield* streamOpenAiCompat({
      client,
      messages: opts.messages,
      model,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    });
    return;
  }

  throw new Error(`unsupported profile type: ${(opts.profile as { type: string }).type}`);
}
