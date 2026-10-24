import { describe, expect, it, beforeAll } from "vitest";
import { buildHouseholdWithMember, buildWorld, createInvite, db, expectRpcDenied, membership, rowsOf, type World } from "./helpers";

describe("a member cannot become an owner", () => {
  it("direct writes to household_members are refused and the role never changes", async () => {
    const { member, householdId } = await buildHouseholdWithMember();
    const c = member.client;

    const upd = await c.from("household_members").update({ role: "owner" }).eq("household_id", householdId).eq("user_id", member.id).select("role");
    if (!upd.error) expect(rowsOf(upd)).toHaveLength(0);

    const ins = await c.from("household_members").insert({ household_id: householdId, user_id: member.id, role: "owner", display_name: "me" });
    expect(ins.error).not.toBeNull();

    const del = await c.from("household_members").delete().eq("household_id", householdId).eq("user_id", member.id).select("user_id");
    if (!del.error) expect(rowsOf(del)).toHaveLength(0);

    expect(await membership(householdId, member.id)).toEqual({ role: "member", status: "active" });
  });

  it("a member cannot add themselves to another household as owner", async () => {
    const { member } = await buildHouseholdWithMember();
    const other: World = await buildWorld();
    const ins = await member.client.from("household_members").insert({ household_id: other.a.householdId, user_id: member.id, role: "owner", display_name: "me" });
    expect(ins.error).not.toBeNull();
    expect(await membership(other.a.householdId, member.id)).toBeNull();
  });

  it("no RPC lets a member change their own role", async () => {
    const { owner, member, householdId } = await buildHouseholdWithMember();
    const c = member.client;
    expectRpcDenied(await c.rpc("create_invite", { p_household: householdId, p_email: member.email }));
    expectRpcDenied(await c.rpc("remove_member", { p_household: householdId, p_user: member.id }));
    expectRpcDenied(await c.rpc("revoke_invite", { p_invite: "00000000-0000-4000-8000-000000000000" }));
    const token = await createInvite(owner, householdId, `someone-${member.id.slice(0, 6)}@example.test`);
    expectRpcDenied(await c.rpc("accept_invite", { p_token: token, p_display_name: "me" })); // wrong email
    const row = await membership(householdId, member.id);
    expect(row?.role).toBe("member");
  });
});

describe("an outsider cannot join a household by guessing", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });
  it("B's owner cannot become a member of A's household by any API call", async () => {
    const res = await w.b.client.rpc("accept_invite", { p_token: "guess", p_display_name: "x" });
    expectRpcDenied(res);
    const n = await db(async (c) => Number((await c.query("select count(*) from public.household_members where household_id = $1 and user_id = $2", [w.a.householdId, w.b.id])).rows[0].count));
    expect(n).toBe(0);
  });
});
