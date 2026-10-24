import { describe, expect, it } from "vitest";
import {
  acceptInvite,
  buildWorld,
  buildHouseholdWithMember,
  createHousehold,
  createInvite,
  db,
  expectRpcDenied,
  makeUser,
  membership,
  rand,
  rowsOf,
  signIn,
} from "./helpers";

async function ownerHousehold() {
  const owner = await makeUser("owner");
  const householdId = await createHousehold(owner, "Invite house", "Owner");
  return { owner, householdId };
}

async function inviteIdFor(householdId: string, email: string): Promise<string> {
  return db(async (c) => (await c.query("select id from public.household_invites where household_id = $1 and email = $2 order by created_at desc limit 1", [householdId, email])).rows[0].id as string);
}

describe("invites through the real API", () => {
  it("a brand-new user with no invite can create a household and sees nothing of the others", async () => {
    const other = await buildWorld();
    const fresh = await makeUser("fresh");
    expect(rowsOf(await fresh.client.from("households").select("id"))).toHaveLength(0);
    const hh = await createHousehold(fresh, "Fresh house", "Fresh");
    const seen = rowsOf(await fresh.client.from("households").select("id")) as { id: string }[];
    expect(seen.map((r) => r.id)).toEqual([hh]);
    for (const t of ["tasks", "snags", "documents", "household_records", "wifi_networks", "notifications", "household_invites"]) {
      const rows = rowsOf(await fresh.client.from(t).select("id,household_id").in("household_id", [other.a.householdId, other.b.householdId]));
      expect(rows, t).toHaveLength(0);
    }
    expect(await membership(hh, fresh.id)).toEqual({ role: "owner", status: "active" });
  });

  it("a user may own at most 3 households; the 4th is refused", async () => {
    const u = await makeUser("many");
    for (let i = 1; i <= 3; i++) await createHousehold(u, `House ${i}`, "Many");
    const fourth = await u.client.rpc("create_household", { p_name: "House 4", p_display_name: "Many" });
    expect(expectRpcDenied(fourth)).toBe("42501");
    expect(fourth.error?.message).toContain("household limit reached");
    const n = await db(async (c) => Number((await c.query("select count(*) from public.household_members where user_id = $1", [u.id])).rows[0].count));
    expect(n).toBe(3);
  });

  it("owner invites, matching email accepts and gains member access", async () => {
    const { owner, householdId } = await ownerHousehold();
    await db((c) => c.query("insert into public.tasks (household_id, title) values ($1, 'shared task')", [householdId]));
    const invitee = await makeUser("invitee");
    const token = await createInvite(owner, householdId, invitee.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url, shown once

    const before = await invitee.client.from("tasks").select("id").eq("household_id", householdId);
    expect(rowsOf(before)).toHaveLength(0);

    const res = await acceptInvite(invitee, token, "New member");
    expect(res.error).toBeNull();
    expect(res.data).toBe(householdId);
    expect(await membership(householdId, invitee.id)).toEqual({ role: "member", status: "active" });
    expect(rowsOf(await invitee.client.from("tasks").select("id").eq("household_id", householdId))).toHaveLength(1);
  });

  it("a user with the wrong email cannot accept, and nothing changes", async () => {
    const { owner, householdId } = await ownerHousehold();
    const intended = await makeUser("intended");
    const thief = await makeUser("thief");
    const token = await createInvite(owner, householdId, intended.email);
    expectRpcDenied(await acceptInvite(thief, token));
    expect(await membership(householdId, thief.id)).toBeNull();
    // The rightful invitee can still use it afterwards.
    expect((await acceptInvite(intended, token)).error).toBeNull();
  });

  it("a token cannot be reused, and garbage tokens fail", async () => {
    const { owner, householdId } = await ownerHousehold();
    const invitee = await makeUser("reuse");
    const token = await createInvite(owner, householdId, invitee.email);
    expect((await acceptInvite(invitee, token)).error).toBeNull();
    expectRpcDenied(await acceptInvite(invitee, token));
    expectRpcDenied(await acceptInvite(invitee, "not-a-real-token"));
    expectRpcDenied(await acceptInvite(invitee, ""));
  });

  it("a revoked invite cannot be accepted; a new invite revokes the previous pending one", async () => {
    const { owner, householdId } = await ownerHousehold();
    const invitee = await makeUser("revoked");
    const token = await createInvite(owner, householdId, invitee.email);
    const inviteId = await inviteIdFor(householdId, invitee.email);
    const rev = await owner.client.rpc("revoke_invite", { p_invite: inviteId });
    expect(rev.error).toBeNull();
    expectRpcDenied(await acceptInvite(invitee, token));
    expect(await membership(householdId, invitee.id)).toBeNull();

    const first = await createInvite(owner, householdId, invitee.email);
    const second = await createInvite(owner, householdId, invitee.email);
    expectRpcDenied(await acceptInvite(invitee, first));
    expect((await acceptInvite(invitee, second)).error).toBeNull();
  });

  it("an expired invite cannot be accepted", async () => {
    const { owner, householdId } = await ownerHousehold();
    const invitee = await makeUser("expired");
    const token = await createInvite(owner, householdId, invitee.email);
    await db((c) =>
      c.query("update public.household_invites set expires_at = now() - interval '1 minute' where household_id = $1 and email = $2", [householdId, invitee.email]),
    );
    expectRpcDenied(await acceptInvite(invitee, token));
    expect(await membership(householdId, invitee.id)).toBeNull();
  });

  it("only an active owner can create or revoke invites", async () => {
    const { owner, member, householdId } = await buildHouseholdWithMember();
    const other = await ownerHousehold();
    const target = `target-${rand()}@example.test`;
    expectRpcDenied(await member.client.rpc("create_invite", { p_household: householdId, p_email: target }));
    expectRpcDenied(await other.owner.client.rpc("create_invite", { p_household: householdId, p_email: target }));

    await createInvite(owner, householdId, target);
    const inviteId = await inviteIdFor(householdId, target);
    expectRpcDenied(await member.client.rpc("revoke_invite", { p_invite: inviteId }));
    expectRpcDenied(await other.owner.client.rpc("revoke_invite", { p_invite: inviteId }));
    // Existing active members cannot be invited again.
    expectRpcDenied(await owner.client.rpc("create_invite", { p_household: householdId, p_email: member.email }));
  });

  it("only owners can see pending invites, and only their own household's", async () => {
    const { owner, member, householdId } = await buildHouseholdWithMember();
    const other = await ownerHousehold();
    await createInvite(owner, householdId, `seen-${rand()}@example.test`);
    const cols = "id,household_id,email,expires_at";
    expect(rowsOf(await owner.client.from("household_invites").select(cols)).length).toBeGreaterThan(0);
    expect(rowsOf(await member.client.from("household_invites").select(cols))).toHaveLength(0);
    expect(rowsOf(await other.owner.client.from("household_invites").select(cols).eq("household_id", householdId))).toHaveLength(0);
  });

  it("two concurrent accepts of one invite: exactly one succeeds", async () => {
    for (let round = 0; round < 3; round++) {
      const { owner, householdId } = await ownerHousehold();
      const invitee = await makeUser("race");
      const token = await createInvite(owner, householdId, invitee.email);
      const [c1, c2] = await Promise.all([signIn(invitee.email), signIn(invitee.email)]);
      const results = await Promise.all([
        c1.rpc("accept_invite", { p_token: token, p_display_name: "Racer" }),
        c2.rpc("accept_invite", { p_token: token, p_display_name: "Racer" }),
      ]);
      const ok = results.filter((r) => !r.error);
      const failed = results.filter((r) => r.error);
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expectRpcDenied(failed[0]);
      const counts = await db(async (c) => ({
        members: Number((await c.query("select count(*) from public.household_members where household_id = $1 and user_id = $2", [householdId, invitee.id])).rows[0].count),
        accepted: Number((await c.query("select count(*) from public.household_invites where household_id = $1 and accepted_at is not null", [householdId])).rows[0].count),
      }));
      expect(counts).toEqual({ members: 1, accepted: 1 });
    }
  });
});
