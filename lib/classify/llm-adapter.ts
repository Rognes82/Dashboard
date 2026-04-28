import type { LlmProfile } from "../llm/types";
import { getProfileSecret } from "../llm/profiles";
import type { ClassifierLlm } from "./run";

export function buildClassifierLlm(profile: LlmProfile): ClassifierLlm {
  const modelName = profile.default_model;
  return {
    modelName,
    async complete(system: string, user: string): Promise<string> {
      const apiKey = getProfileSecret(profile.id);
      if (profile.type === "anthropic") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });
        const result = await client.messages.create({
          model: profile.default_model,
          max_tokens: 1024,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
        });
        const block = result.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new Error("no text block in Anthropic response");
        return block.text;
      } else {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey, baseURL: profile.base_url });
        const result = await client.chat.completions.create({
          model: profile.default_model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1024,
        });
        const text = result.choices[0]?.message?.content;
        if (!text) throw new Error("no content in OpenAI-compat response");
        return text;
      }
    },
  };
}
