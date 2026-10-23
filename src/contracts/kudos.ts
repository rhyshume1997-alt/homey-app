import { z } from "zod";

/** Mirrors supabase/migrations/20261024101000_kudos.sql. */
export const KUDOS_MAX = 200;

/** Plain text only: trimmed, 1..200, no control characters. Rendered as text, never markup. */
export const KudosMessageSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(KUDOS_MAX)
      // eslint-disable-next-line no-control-regex
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "No control characters"),
  );

export const KudosKeySchema = z.string().regex(/^kudos:[1-9]\d{0,14}$/);

/** "kudos:<audit id>" to the audit id, or null. */
export function parseKudosKey(key: unknown): number | null {
  const p = KudosKeySchema.safeParse(key);
  if (!p.success) return null;
  const n = Number(p.data.slice("kudos:".length));
  return Number.isSafeInteger(n) ? n : null;
}

export type ReceivedKudos = { id: string; fromName: string; message: string; createdAt: string };
