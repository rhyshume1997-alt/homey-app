import "server-only";
import { z } from "zod";

/** Which household this browser is looking at. Only a preference: membership is re-checked on every request. */
export const HOUSEHOLD_COOKIE = "oh_household";
/** Carries an invite token across sign-in so it never sits in a URL. Short-lived, httpOnly. */
export const INVITE_COOKIE = "oh_invite";
export const INVITE_COOKIE_MAX_AGE_S = 15 * 60;

/** 32 random bytes as base64url, no padding. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(v: unknown): v is string {
  return typeof v === "string" && INVITE_TOKEN.test(v);
}

export function parseHouseholdCookie(v: string | undefined | null): string | null {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
}

export function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

export type MembershipRow = { householdId: string; name: string; role: "owner" | "member"; displayName: string };

/** The cookie's household if it is one the caller actively belongs to, else the oldest (rows arrive oldest first). */
export function pickMembership<T extends { householdId: string }>(rows: readonly T[], cookie: string | null | undefined): T | null {
  if (rows.length === 0) return null;
  const wanted = parseHouseholdCookie(cookie);
  return (wanted ? rows.find((r) => r.householdId === wanted) : undefined) ?? rows[0];
}
