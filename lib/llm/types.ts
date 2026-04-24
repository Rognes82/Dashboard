export type LlmProviderType = "anthropic" | "openai-compatible";

export interface LlmProfile {
  id: string;
  name: string;
  type: LlmProviderType;
  api_key_encrypted: string;
  base_url?: string;
  default_model: string;
  max_context_tokens: number;
  created_at: string;
}

export interface LlmProfileInput {
  name: string;
  type: LlmProviderType;
  api_key: string;
  base_url?: string;
  default_model: string;
  max_context_tokens?: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmStreamChunk =
  | { type: "text"; text: string }
  | { type: "done"; usage?: { input_tokens?: number; output_tokens?: number } }
  | { type: "error"; status?: number; message: string };

export interface StreamChatOptions {
  messages: LlmMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}
