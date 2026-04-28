import path from "path";

export const DEFAULT_VAULT_RELATIVE_PATH = path.join(
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
  "icloud-shared",
  "Obsidian",
  "Obsidian Vault"
);

export function defaultVaultPath(home = process.env.HOME ?? ""): string {
  return path.join(home, DEFAULT_VAULT_RELATIVE_PATH);
}

export function getVaultPath(): string {
  const configured = process.env.VAULT_PATH?.trim();
  return configured && configured.length > 0 ? configured : defaultVaultPath();
}
