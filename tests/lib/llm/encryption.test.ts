import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, getOrCreateMachineKey, MACHINE_KEY_PATH } from "../../../lib/llm/encryption";
import fs from "fs";
import path from "path";
import os from "os";

let TEST_HOME: string;
const ORIGINAL_HOME = process.env.HOME;

describe("encryption", () => {
  beforeEach(() => {
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "enc-test-home-"));
    process.env.HOME = TEST_HOME;
  });
  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("getOrCreateMachineKey creates a 32-byte key with 0600 mode on first call", () => {
    const key = getOrCreateMachineKey();
    expect(key.length).toBe(32);
    const keyPath = path.join(TEST_HOME, ".config", "dashboard", "machine-key");
    expect(fs.existsSync(keyPath)).toBe(true);
    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("getOrCreateMachineKey returns same key on subsequent calls", () => {
    const k1 = getOrCreateMachineKey();
    const k2 = getOrCreateMachineKey();
    expect(Buffer.compare(k1, k2)).toBe(0);
  });

  it("encryptSecret + decryptSecret round-trip", () => {
    const plaintext = "sk-ant-abcdef1234567890";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("different ciphertexts for same plaintext (random IV)", () => {
    const c1 = encryptSecret("same");
    const c2 = encryptSecret("same");
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe("same");
    expect(decryptSecret(c2)).toBe("same");
  });

  it("decryptSecret throws on tampered ciphertext", () => {
    const valid = encryptSecret("secret");
    const tampered = valid.slice(0, -4) + "XXXX";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("MACHINE_KEY_PATH resolves under HOME/.config/dashboard/", () => {
    expect(MACHINE_KEY_PATH()).toBe(path.join(TEST_HOME, ".config", "dashboard", "machine-key"));
  });
});
