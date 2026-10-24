import "server-only";
import { z } from "zod";
import { HouseholdRoleSchema, LIMITS } from "@/contracts/household";
import type { HouseholdRole } from "@/contracts/household";
import { createUserClient } from "@/server/db/supabase";
import { isInviteToken } from "@/server/auth/household-cookie";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  unavailable: "Could not do that right now. Try again shortly.",
  denied: "You don't have permission to do that.",
  invalid: "Check the details and try again.",
  limit: "You've reached the limit of 3 households you can own.",
  paused: "New households are paused for now. Please try again later.",
  createRate: "Too many new households in a day. Please try again tomorrow.",
  inviteRate: "You've sent a lot of invites today. Please try again tomorrow.",
  inviteBad: "This invite link isn't valid any more. Ask the household owner for a new one.",
} as const;

const name = z.string().trim().min(1, "Enter a name.").max(LIMITS.householdName, "That name is too long.");
const displayName = z.string().trim().min(1, "Enter your name.").max(LIMITS.displayName, "That name is too long.");
const uuid = z.uuid();
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const CreateHouseholdInput = z.object({ name, displayName });
export const CreateInviteInput = z.object({ household: uuid, email });
export const AcceptInviteInput = z.object({
  token: z.string().refine(isInviteToken, "bad token"),
  displayName,
});

function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message && e.issues[0].message !== "Invalid input" ? e.issues[0].message : MSG.invalid;
}

/** Maps a Postgres error from an RPC to friendly text. Never echoes the database message. */
function rpcError(err: { code?: string } | null, on42501: string = MSG.denied, on22023: string = MSG.invalid): string {
  if (err?.code === "42501") return on42501;
  if (err?.code === "22023") return on22023;
  return MSG.unavailable;
}

export async function createHousehold(input: unknown): Promise<Result<{ householdId: string }>> {
  const p = CreateHouseholdInput.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { data, error } = await db.rpc("create_household", { p_name: p.data.name, p_display_name: p.data.displayName });
  if (error) {
    const msg = error.code === "42501" ? (error.message ?? "") : "";
    if (/household creation is paused/i.test(msg)) return { ok: false, error: MSG.paused };
    if (/rate limit reached/i.test(msg)) return { ok: false, error: MSG.createRate };
    return { ok: false, error: /household limit reached/i.test(msg) ? MSG.limit : rpcError(error) };
  }
  const id = uuid.safeParse(data);
  return id.success ? { ok: true, data: { householdId: id.data } } : { ok: false, error: MSG.unavailable };
}

/** Returns the invite token ONCE. It is never stored by the app and never logged. */
export async function createInvite(input: unknown): Promise<Result<{ token: string }>> {
  const p = CreateInviteInput.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter a valid email address." };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { data, error } = await db.rpc("create_invite", { p_household: p.data.household, p_email: p.data.email });
  if (error) {
    if (error.code === "42501" && /rate limit reached/i.test(error.message ?? "")) return { ok: false, error: MSG.inviteRate };
    return { ok: false, error: rpcError(error, "Only a household owner can invite people.", "That person is already a member, or the email isn't valid.") };
  }
  if (!isInviteToken(data)) return { ok: false, error: MSG.unavailable };
  return { ok: true, data: { token: data } };
}

export async function revokeInvite(inviteId: unknown): Promise<Result> {
  const id = uuid.safeParse(inviteId);
  if (!id.success) return { ok: false, error: MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { error } = await db.rpc("revoke_invite", { p_invite: id.data });
  return error ? { ok: false, error: rpcError(error, "Only a household owner can revoke invites.") } : { ok: true, data: undefined };
}

export async function acceptInvite(input: unknown): Promise<Result<{ householdId: string }>> {
  const p = AcceptInviteInput.safeParse(input);
  if (!p.success) {
    const bad = p.error.issues.some((i) => i.path[0] === "token");
    return { ok: false, error: bad ? MSG.inviteBad : firstIssue(p.error) };
  }
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { data, error } = await db.rpc("accept_invite", { p_token: p.data.token, p_display_name: p.data.displayName });
  // Expired, revoked, reused and wrong-email all look the same on purpose.
  if (error) return { ok: false, error: error.code === "42501" || error.code === "22023" ? MSG.inviteBad : MSG.unavailable };
  const id = uuid.safeParse(data);
  return id.success ? { ok: true, data: { householdId: id.data } } : { ok: false, error: MSG.unavailable };
}

export async function removeMember(householdId: unknown, userId: unknown): Promise<Result> {
  const h = uuid.safeParse(householdId);
  const u = uuid.safeParse(userId);
  if (!h.success || !u.success) return { ok: false, error: MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { error } = await db.rpc("remove_member", { p_household: h.data, p_user: u.data });
  return error
    ? { ok: false, error: rpcError(error, "Only a household owner can remove people, and the last owner can't be removed.", "That person can't be removed.") }
    : { ok: true, data: undefined };
}

export async function leaveHousehold(householdId: unknown): Promise<Result> {
  const h = uuid.safeParse(householdId);
  if (!h.success) return { ok: false, error: MSG.invalid };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.unavailable };
  const { error } = await db.rpc("leave_household", { p_household: h.data });
  return error
    ? { ok: false, error: rpcError(error, "The last owner can't leave. Make someone else an owner first, or ask the operator.", MSG.invalid) }
    : { ok: true, data: undefined };
}

const ManagedMemberRow = z.object({
  user_id: z.uuid(),
  display_name: z.string().min(1).max(LIMITS.displayName),
  role: HouseholdRoleSchema,
});
export type ManagedMember = { userId: string; displayName: string; role: HouseholdRole };

/** Active members with ids (needed to remove one). RLS limits this to households the caller is in. */
export async function listActiveMembers(householdId: string): Promise<ManagedMember[] | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data, error } = await db
    .from("household_members")
    .select("user_id, display_name, role")
    .eq("household_id", householdId)
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (error || !data) return null;
  const out: ManagedMember[] = [];
  for (const raw of data) {
    const r = ManagedMemberRow.safeParse(raw);
    if (r.success) out.push({ userId: r.data.user_id, displayName: r.data.display_name, role: r.data.role });
  }
  return out;
}

const InviteRow = z.object({ id: z.uuid(), email: z.string(), expires_at: z.string(), created_at: z.string() });
export type PendingInvite = { id: string; email: string; expiresAt: string; createdAt: string };

/** Pending invites. Owner-only under RLS (others get an empty list). token_hash is never selected. */
export async function listPendingInvites(householdId: string): Promise<PendingInvite[] | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data, error } = await db
    .from("household_invites")
    .select("id, email, expires_at, created_at")
    .eq("household_id", householdId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error || !data) return null;
  const out: PendingInvite[] = [];
  for (const raw of data) {
    const r = InviteRow.safeParse(raw);
    if (r.success) out.push({ id: r.data.id, email: r.data.email, expiresAt: r.data.expires_at, createdAt: r.data.created_at });
  }
  return out;
}
