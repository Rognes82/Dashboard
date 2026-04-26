import { getSetting } from "../queries/app-settings";

export function resolveClassifyProfileId(): string | null {
  const explicit = getSetting("classify.profile_id");
  if (explicit) return explicit;
  const active = getSetting("llm.active_profile_id");
  if (active) return active;
  return null;
}
