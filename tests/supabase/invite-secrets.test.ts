import { describe, expect, it } from "vitest";
import { anonClient, buildHouseholdWithMember, createInvite, db, rand, rowsOf, sha256hex } from "./helpers";

describe("household_invites never exposes token_hash", () => {
  it("no select returns token_hash to an owner, a member or anon", async () => {
    const { owner, member, householdId } = await buildHouseholdWithMember();
    const token = await createInvite(owner, householdId, `secret-${rand()}@example.test`);

    for (const [who, client] of [["owner", owner.client], ["member", member.client], ["anon", anonClient()]] as const) {
      const direct = await client.from("household_invites").select("token_hash");
      expect(rowsOf(direct).length, `${who} select token_hash`).toBe(0);
      const star = await client.from("household_invites").select("*");
      for (const row of rowsOf(star) as Record<string, unknown>[]) expect(row).not.toHaveProperty("token_hash");
      const filtered = await client.from("household_invites").select("id").eq("token_hash", sha256hex(token));
      expect(rowsOf(filtered), `${who} filter by token_hash`).toHaveLength(0);
    }

    // Embedding through the parent table does not leak it either.
    const embedded = await owner.client.from("households").select("id, household_invites(*)").eq("id", householdId);
    expect(JSON.stringify(embedded.data ?? [])).not.toContain("token_hash");
  });

  it("an owner can list invites without the hash, and the plaintext token is stored nowhere", async () => {
    const { owner, householdId } = await buildHouseholdWithMember();
    const token = await createInvite(owner, householdId, `plain-${rand()}@example.test`);
    const listed = await owner.client.from("household_invites").select("id,email,expires_at,accepted_at,revoked_at").eq("household_id", householdId);
    expect(listed.error).toBeNull();
    expect(rowsOf(listed).length).toBeGreaterThan(0);

    const stored = await db(async (c) => {
      const inv = await c.query("select to_jsonb(i)::text as j, token_hash from public.household_invites i where household_id = $1", [householdId]);
      const audit = await c.query("select to_jsonb(a)::text as j from public.audit_log a where household_id = $1", [householdId]);
      return { inv: inv.rows as { j: string; token_hash: string }[], audit: audit.rows as { j: string }[] };
    });
    expect(stored.inv.some((r) => r.token_hash === sha256hex(token))).toBe(true);
    for (const r of [...stored.inv, ...stored.audit]) expect(r.j).not.toContain(token);
  });
});
