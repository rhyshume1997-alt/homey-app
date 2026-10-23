import "server-only";
import { decryptToken, encryptToken, parseKey } from "@/server/integrations/google/crypto";
import { getServerEnv } from "@/server/env";

/**
 * Encrypts small household secrets (e.g. the guest wifi password) with the existing
 * GOOGLE_TOKEN_ENCRYPTION_KEY (AES-256-GCM). The household id is bound in as AAD with a
 * purpose prefix, so a ciphertext moved to another household or purpose will not decrypt.
 */

const aad = (purpose: string, householdId: string) => `${purpose}:${householdId}`;

function key(): string | null {
  const k = getServerEnv().GOOGLE_TOKEN_ENCRYPTION_KEY;
  return k && parseKey(k) ? k : null;
}

export function householdSecretsConfigured(): boolean {
  return key() !== null;
}

/** Throws when the key is missing: callers must never fall back to storing plaintext. */
export function encryptHouseholdSecret(purpose: string, householdId: string, plain: string, keyB64: string | null = key()): string {
  if (!keyB64) throw new Error("Household secret storage is not configured.");
  return encryptToken(plain, keyB64, aad(purpose, householdId));
}

export function decryptHouseholdSecret(purpose: string, householdId: string, blob: string, keyB64: string | null = key()): string {
  if (!keyB64) throw new Error("Household secret storage is not configured.");
  return decryptToken(blob, keyB64, aad(purpose, householdId));
}
