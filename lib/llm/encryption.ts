import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export function MACHINE_KEY_PATH(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".config", "dashboard", "machine-key");
}

export function getOrCreateMachineKey(): Buffer {
  const keyPath = MACHINE_KEY_PATH();
  if (fs.existsSync(keyPath)) {
    const buf = fs.readFileSync(keyPath);
    if (buf.length !== KEY_LENGTH) {
      throw new Error(`machine-key at ${keyPath} is ${buf.length} bytes, expected ${KEY_LENGTH}`);
    }
    return buf;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(KEY_LENGTH);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export function hasMachineKey(): boolean {
  const keyPath = MACHINE_KEY_PATH();
  if (!fs.existsSync(keyPath)) return false;
  try {
    const buf = fs.readFileSync(keyPath);
    return buf.length === KEY_LENGTH;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = getOrCreateMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getOrCreateMachineKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
