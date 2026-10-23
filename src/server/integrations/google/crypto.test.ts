import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, decryptToken, deriveThreadKey, encryptToken, threadHash } from "./crypto";

const KEY = randomBytes(32).toString("base64");
const UID = "11111111-1111-4111-8111-111111111111";

describe("token encryption", () => {
  it("round trips with a versioned format and fresh IV each time", () => {
    const a = encryptToken("1//refresh-token", KEY, UID);
    const b = encryptToken("1//refresh-token", KEY, UID);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("refresh-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a, KEY, UID)).toBe("1//refresh-token");
    expect(a.length).toBeLessThan(4000);
  });

  it("rejects tampering, wrong key, wrong user, wrong version and malformed input", () => {
    const blob = encryptToken("secret", KEY, UID);
    const [v, iv, ct, tag] = blob.split(":") as [string, string, string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [
      [v, iv, flip(ct), tag], [v, flip(iv), ct, tag], [v, iv, ct, flip(tag)], ["v2", iv, ct, tag], [v, iv, ct], [v, iv, ct, tag, "x"],
    ]) {
      expect(() => decryptToken(bad.join(":"), KEY, UID)).toThrow(CryptoError);
    }
    expect(() => decryptToken(blob, randomBytes(32).toString("base64"), UID)).toThrow(CryptoError);
    expect(() => decryptToken(blob, KEY, "22222222-2222-4222-8222-222222222222")).toThrow(CryptoError);
    expect(() => decryptToken("garbage", KEY, UID)).toThrow(CryptoError);
  });

  it("rejects a key that is not 32 base64 bytes", () => {
    expect(() => encryptToken("x", "short", UID)).toThrow(CryptoError);
    expect(() => encryptToken("x", randomBytes(16).toString("base64"), UID)).toThrow(CryptoError);
  });

  it("error message never contains the plaintext", () => {
    try {
      decryptToken("v1:a:b:c", KEY, UID);
    } catch (e) {
      expect((e as Error).message).not.toContain("secret");
    }
  });
});

describe("thread hash", () => {
  it("is stable, hex, key dependent and not the plain sha256", () => {
    const k = deriveThreadKey(KEY);
    expect(threadHash("18c2f", k)).toMatch(/^[0-9a-f]{64}$/);
    expect(threadHash("18c2f", k)).toBe(threadHash("18c2f", deriveThreadKey(KEY)));
    expect(threadHash("18c2f", k)).not.toBe(threadHash("18c30", k));
    expect(threadHash("18c2f", k)).not.toBe(threadHash("18c2f", deriveThreadKey(randomBytes(32).toString("base64"))));
  });
});
