import { getSettingJson, setSettingJson, setSetting, getSetting } from "../queries/app-settings";
import { newId, nowIso } from "../utils";
import { encryptSecret, decryptSecret } from "./encryption";
import type { LlmProfile, LlmProfileInput, LlmProviderType } from "./types";

const PROFILES_KEY = "llm.profiles";
const ACTIVE_KEY = "llm.active_profile_id";

function defaultMaxContext(type: LlmProviderType, model: string): number {
  if (type === "anthropic") return 200_000;
  // openai-compatible: hard to know the model without a registry; default to a safe 128k
  // Users override per profile if running a smaller local model.
  if (model.includes("local") || model.startsWith("http")) return 32_000;
  return 128_000;
}

function readAll(): LlmProfile[] {
  return getSettingJson<LlmProfile[]>(PROFILES_KEY) ?? [];
}

function writeAll(profiles: LlmProfile[]): void {
  setSettingJson(PROFILES_KEY, profiles);
}

export function listProfiles(): LlmProfile[] {
  const profiles = readAll();
  return [...profiles].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getProfile(id: string): LlmProfile | null {
  return readAll().find((p) => p.id === id) ?? null;
}

export function createProfile(input: LlmProfileInput): LlmProfile {
  const now = nowIso();
  const profile: LlmProfile = {
    id: newId(),
    name: input.name,
    type: input.type,
    api_key_encrypted: encryptSecret(input.api_key),
    base_url: input.base_url,
    default_model: input.default_model,
    max_context_tokens: input.max_context_tokens ?? defaultMaxContext(input.type, input.default_model),
    created_at: now,
  };
  writeAll([...readAll(), profile]);
  // Auto-activate when no profile is currently active (first-profile UX).
  if (!getSetting(ACTIVE_KEY)) {
    setSetting(ACTIVE_KEY, profile.id);
  }
  return profile;
}

export function updateProfile(
  id: string,
  patch: Partial<LlmProfileInput>
): LlmProfile | null {
  const profiles = readAll();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const existing = profiles[idx];
  const next: LlmProfile = {
    ...existing,
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    base_url: patch.base_url === undefined ? existing.base_url : patch.base_url,
    default_model: patch.default_model ?? existing.default_model,
    max_context_tokens: patch.max_context_tokens ?? existing.max_context_tokens,
    api_key_encrypted: patch.api_key
      ? encryptSecret(patch.api_key)
      : existing.api_key_encrypted,
  };
  profiles[idx] = next;
  writeAll(profiles);
  return next;
}

export function deleteProfile(id: string): void {
  const profiles = readAll().filter((p) => p.id !== id);
  writeAll(profiles);
  if (getSetting(ACTIVE_KEY) === id) {
    setSetting(ACTIVE_KEY, "");
  }
}

export function getActiveProfile(): LlmProfile | null {
  const id = getSetting(ACTIVE_KEY);
  if (!id) return null;
  return getProfile(id);
}

export function setActiveProfile(id: string): void {
  if (!getProfile(id)) throw new Error(`profile ${id} not found`);
  setSetting(ACTIVE_KEY, id);
}

export function getProfileSecret(id: string): string {
  const profile = getProfile(id);
  if (!profile) throw new Error(`profile ${id} not found`);
  return decryptSecret(profile.api_key_encrypted);
}

export function runMigrationFromEnv(): void {
  if (readAll().length > 0) return;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  const profile = createProfile({
    name: "Claude direct",
    type: "anthropic",
    api_key: key,
    default_model: "claude-opus-4-7",
  });
  setActiveProfile(profile.id);
}
