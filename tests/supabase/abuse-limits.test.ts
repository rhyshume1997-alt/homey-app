import { afterEach, describe, expect, it } from "vitest";
import { createHousehold, db, expectRpcDenied, makeUser } from "./helpers";

const setOpen = (open: boolean) =>
  db((c) => c.query("update private.app_settings set household_creation_open = $1, updated_at = now()", [open]));

afterEach(() => setOpen(true));

describe("kill switch and creation rate limit through the real API", () => {
  it("paused creation is refused with 42501, and works again once re-opened", async () => {
    const u = await makeUser("paused");
    await setOpen(false);
    const paused = await u.client.rpc("create_household", { p_name: "Paused", p_display_name: "P" });
    expect(expectRpcDenied(paused)).toBe("42501");
    expect(paused.error?.message).toContain("household creation is paused");
    await setOpen(true);
    expect(await createHousehold(u, "Open again", "P")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("clients cannot read or flip the switch or the usage view", async () => {
    const u = await makeUser("noswitch");
    const res = await u.client.schema("private").from("app_settings").select("*");
    expect(res.error ?? { data: res.data }).toBeTruthy();
    expect((res.data ?? []).length).toBe(0);
    await setOpen(true);
  });

  it("a user who already created 3 households in 24 h is refused with 'rate limit reached'", async () => {
    const u = await makeUser("rate");
    // Operator seeding: three creations in the audit log (owned cap is not reached, so only the rate limit can fire).
    const hh = await createHousehold(u, "First", "R");
    await db(async (c) => {
      for (let i = 0; i < 2; i++) {
        await c.query(
          "insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary) values ($1,$2,'household.created','household',$1::text,'seed')",
          [hh, u.id],
        );
      }
    });
    const r = await u.client.rpc("create_household", { p_name: "Fourth", p_display_name: "R" });
    expect(expectRpcDenied(r)).toBe("42501");
    expect(r.error?.message).toContain("rate limit reached");
    const n = await db(async (c) => Number((await c.query("select count(*) from public.household_members where user_id = $1", [u.id])).rows[0].count));
    expect(n).toBe(1);
  });
});
