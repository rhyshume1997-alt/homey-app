import "server-only";
import { z } from "zod";

// Add server-side variables here as phases need them (never browser-exposed secrets).
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Integrations. All optional: a missing value means that integration is off (deny by default).
  // Google (D17): the household owner's own Google sign-in with read-only scopes (spreadsheets.readonly,
  // gmail.readonly), using the same OAuth client as Supabase sign-in. The client secret lets the
  // server refresh the user's access token; refresh tokens are stored encrypted with this key.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  /** 32 random bytes, base64. Encrypts stored Google refresh tokens (AES-256-GCM). */
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/).optional(),
  /**
   * The one household that may use the server-wide costs sheet and the paid AI features until
   * per-household configuration and billing exist. Unset means both are off for everyone.
   */
  PRIMARY_HOUSEHOLD_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
  COSTS_SHEET_ID: z.string().regex(/^[A-Za-z0-9_-]{20,}$/).optional(),
  // Claude API for the assistant (server only) and its monthly spend cap in GBP.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MONTHLY_CAP_GBP: z.coerce.number().positive().max(50).default(5),
  // Web Push (VAPID). The public key is served by an authenticated route, never a public build variable.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().startsWith("mailto:").optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverSchema.parse(process.env);
  return cached;
}

/** True only when PRIMARY_HOUSEHOLD_ID is set and equals this household. Unset env => false for everyone. */
export function isPrimaryHousehold(householdId: string | null | undefined): boolean {
  const primary = getServerEnv().PRIMARY_HOUSEHOLD_ID;
  return !!primary && !!householdId && primary.toLowerCase() === householdId.toLowerCase();
}
