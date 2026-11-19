import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("AES-256-GCM secret encryption", () => {
  it("round-trips database passwords with unique IVs", () => {
    const password = "super-secret-pg-password-!@#$%";
    const enc1 = encryptSecret(password);
    const enc2 = encryptSecret(password);

    expect(enc1).not.toBe(password);
    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1)).toBe(password);
    expect(decryptSecret(enc2)).toBe(password);
  });

  it("throws on tampered ciphertext", () => {
    const enc = encryptSecret("my-secret");
    const parts = enc.split(":");
    const tampered = `${parts[0]}:${parts[1]}:AAAA${parts[2].slice(4)}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
