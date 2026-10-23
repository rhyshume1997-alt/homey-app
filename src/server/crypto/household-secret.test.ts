import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptHouseholdSecret, encryptHouseholdSecret } from "./household-secret";

const key = randomBytes(32).toString("base64");
const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";

describe("household secrets", () => {
  it("round-trips and never contains the plaintext", () => {
    const blob = encryptHouseholdSecret("wifi", H1, "hunter2 pass", key);
    expect(blob).not.toContain("hunter2");
    expect(decryptHouseholdSecret("wifi", H1, blob, key)).toBe("hunter2 pass");
  });
  it("uses a fresh iv each time", () => {
    expect(encryptHouseholdSecret("wifi", H1, "x", key)).not.toBe(encryptHouseholdSecret("wifi", H1, "x", key));
  });
  it("will not decrypt for another household, purpose or key", () => {
    const blob = encryptHouseholdSecret("wifi", H1, "secret", key);
    expect(() => decryptHouseholdSecret("wifi", H2, blob, key)).toThrow();
    expect(() => decryptHouseholdSecret("other", H1, blob, key)).toThrow();
    expect(() => decryptHouseholdSecret("wifi", H1, blob, randomBytes(32).toString("base64"))).toThrow();
  });
  it("detects tampering", () => {
    const parts = encryptHouseholdSecret("wifi", H1, "secret", key).split(":");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptHouseholdSecret("wifi", H1, parts.join(":"), key)).toThrow();
  });
  it("refuses to encrypt without a key (no plaintext fallback)", () => {
    expect(() => encryptHouseholdSecret("wifi", H1, "secret", null)).toThrow();
  });
});
