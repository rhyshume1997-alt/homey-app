import { describe, expect, it } from "vitest";
import {
  BUCKET,
  acceptInvite,
  buildHouseholdWithMember,
  createInvite,
  db,
  expectRpcDenied,
  inviteAndJoin,
  membership,
  rowsOf,
} from "./helpers";

describe("removing a member takes effect immediately on the same JWT", () => {
  it("removed member loses tasks, documents, storage and signed URLs", async () => {
    const { owner, member, householdId, seed } = await buildHouseholdWithMember();
    const store = member.client.storage.from(BUCKET);

    // Before removal the member has access (positive control).
    expect(rowsOf(await member.client.from("tasks").select("id").eq("household_id", householdId)).length).toBeGreaterThan(0);
    expect(rowsOf(await member.client.from("documents").select("id").eq("household_id", householdId)).length).toBeGreaterThan(0);
    expect((await store.download(seed.storagePath)).error).toBeNull();
    expect((await store.createSignedUrl(seed.storagePath, 60)).error).toBeNull();

    const rm = await owner.client.rpc("remove_member", { p_household: householdId, p_user: member.id });
    expect(rm.error).toBeNull();
    expect(await membership(householdId, member.id)).toMatchObject({ status: "removed" });

    // Same session, no refresh: every door is closed.
    for (const table of ["tasks", "snags", "documents", "household_records", "wifi_networks", "notifications", "household_members", "audit_log"]) {
      expect(rowsOf(await member.client.from(table).select("*").eq("household_id", householdId)), table).toHaveLength(0);
    }
    expect(rowsOf(await member.client.from("households").select("id").eq("id", householdId))).toHaveLength(0);
    expect((await member.client.from("tasks").insert({ household_id: householdId, title: "after removal" })).error).not.toBeNull();
    const upd = await member.client.from("tasks").update({ title: "hacked" }).eq("id", seed.taskId).select("id");
    if (!upd.error) expect(rowsOf(upd)).toHaveLength(0);

    expect((await store.download(seed.storagePath)).error).not.toBeNull();
    expect((await store.list(householdId)).data ?? []).toHaveLength(0);
    expect((await store.createSignedUrl(seed.storagePath, 60)).error).not.toBeNull();
    const up = await store.upload(`${householdId}/${seed.documentId}/after.pdf`, Buffer.from("%PDF-1.4 x"), { contentType: "application/pdf" });
    expect(up.error).not.toBeNull();

    const taskTitle = await db(async (c) => (await c.query("select title from public.tasks where id = $1", [seed.taskId])).rows[0].title);
    expect(taskTitle).toBe("seed task");
  });

  it("a member cannot remove others; the last owner can neither be removed nor leave", async () => {
    const { owner, member, householdId } = await buildHouseholdWithMember();
    expectRpcDenied(await member.client.rpc("remove_member", { p_household: householdId, p_user: owner.id }));
    expectRpcDenied(await owner.client.rpc("remove_member", { p_household: householdId, p_user: owner.id }));
    expectRpcDenied(await owner.client.rpc("leave_household", { p_household: householdId }));
    expect(await membership(householdId, owner.id)).toMatchObject({ role: "owner", status: "active" });
  });

  it("a member who leaves loses access", async () => {
    const { member, householdId, seed } = await buildHouseholdWithMember();
    const res = await member.client.rpc("leave_household", { p_household: householdId });
    expect(res.error).toBeNull();
    expect(rowsOf(await member.client.from("tasks").select("id").eq("id", seed.taskId))).toHaveLength(0);
    expect((await member.client.storage.from(BUCKET).download(seed.storagePath)).error).not.toBeNull();
  });

  it("re-inviting a removed member re-activates them as a plain member, even if they were an owner", async () => {
    const { owner, member, householdId, seed } = await buildHouseholdWithMember();
    // Operator makes the member a second owner (no API path does this), then the first owner removes them.
    await db((c) => c.query("update public.household_members set role = 'owner' where household_id = $1 and user_id = $2", [householdId, member.id]));
    expect((await owner.client.rpc("remove_member", { p_household: householdId, p_user: member.id })).error).toBeNull();
    expect((await member.client.from("tasks").select("id").eq("id", seed.taskId)).data ?? []).toHaveLength(0);

    const token = await createInvite(owner, householdId, member.email);
    expect((await acceptInvite(member, token, "Back again")).error).toBeNull();
    expect(await membership(householdId, member.id)).toEqual({ role: "member", status: "active" });
    expect(rowsOf(await member.client.from("tasks").select("id").eq("id", seed.taskId))).toHaveLength(1);
  });

  it("removing one member does not affect another", async () => {
    const { owner, member, householdId, seed } = await buildHouseholdWithMember();
    const other = await inviteAndJoin(owner, householdId, "other");
    expect((await owner.client.rpc("remove_member", { p_household: householdId, p_user: member.id })).error).toBeNull();
    expect(rowsOf(await other.client.from("tasks").select("id").eq("id", seed.taskId))).toHaveLength(1);
  });
});
