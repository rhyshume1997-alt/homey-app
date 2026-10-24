import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_MSG, parseImportForm } from "@/contracts/recipe-import";
import type { HouseholdSession } from "@/server/auth/session";

type Call = { table: string; op: string; args: unknown[] };
const m = vi.hoisted(() => ({
  calls: [] as Call[],
  meal: { id: "x" } as { id: string } | null,
  existing: [] as { name: string }[],
  insertError: null as null | { message: string },
  saveMeal: vi.fn(),
}));

function chain(table: string) {
  const filters: Call[] = [];
  const q: Record<string, unknown> = {};
  const rec = (op: string) => (...args: unknown[]) => {
    const c = { table, op, args };
    m.calls.push(c);
    filters.push(c);
    return q;
  };
  for (const op of ["select", "eq", "in", "order"]) q[op] = rec(op);
  q.maybeSingle = async () => (rec("maybeSingle")(), { data: m.meal, error: null });
  q.insert = async (rows: unknown) => (m.calls.push({ table, op: "insert", args: [rows] }), { error: m.insertError });
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "meal_ingredients" ? m.existing : [], error: null }).then(res);
  return q;
}

vi.mock("@/server/db/supabase", () => ({ createUserClient: async () => ({ from: (t: string) => chain(t) }) }));
vi.mock("@/server/data/meals", () => ({ saveMeal: m.saveMeal }));

const { saveImportedRecipe } = await import("./meal-import");

const MEAL = "11111111-1111-4111-8111-111111111111";
const s = { userId: "u1", householdId: "h1" } as HouseholdSession;

beforeEach(() => {
  m.calls.length = 0;
  m.meal = { id: MEAL };
  m.existing = [];
  m.insertError = null;
  m.saveMeal.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

const inserted = () => m.calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>[] | undefined;

describe("saveImportedRecipe: existing meal", () => {
  it("checks the meal is in the session household and appends with household_id and created_by", async () => {
    const r = await saveImportedRecipe(s, { mode: "existing", meal_id: MEAL, ingredients: [{ name: "Pasta", quantity: "200g" }] });
    expect(r.ok).toBe(true);
    const mealFilters = m.calls.filter((c) => c.table === "meals" && c.op === "eq").map((c) => c.args);
    expect(mealFilters).toEqual(expect.arrayContaining([["id", MEAL], ["household_id", "h1"]]));
    expect(inserted()).toEqual([
      { household_id: "h1", meal_id: MEAL, name: "Pasta", quantity: "200g", unit_price_estimate: null, supply_id: null, created_by: "u1" },
    ]);
  });

  it("refuses a meal outside the household (not found under the filter)", async () => {
    m.meal = null;
    expect(await saveImportedRecipe(s, { mode: "existing", meal_id: MEAL, ingredients: [{ name: "Pasta", quantity: null }] })).toEqual({
      ok: false,
      error: IMPORT_MSG.mealGone,
    });
    expect(inserted()).toBeUndefined();
  });

  it("skips names already on the meal, so a double submit adds nothing twice", async () => {
    m.existing = [{ name: "pasta" }];
    await saveImportedRecipe(s, {
      mode: "existing",
      meal_id: MEAL,
      ingredients: [{ name: "Pasta", quantity: null }, { name: "Basil", quantity: null }, { name: "basil ", quantity: "1" }],
    });
    expect(inserted()?.map((r) => r.name)).toEqual(["Basil"]);
    m.calls.length = 0;
    m.existing = [{ name: "pasta" }, { name: "basil" }];
    expect(await saveImportedRecipe(s, { mode: "existing", meal_id: MEAL, ingredients: [{ name: "Basil", quantity: null }] })).toEqual({
      ok: false,
      error: IMPORT_MSG.nothingNew,
    });
    expect(inserted()).toBeUndefined();
  });

  it("enforces the 30-ingredient limit across existing and new", async () => {
    m.existing = Array.from({ length: 29 }, (_, i) => ({ name: `thing ${i}` }));
    const r = await saveImportedRecipe(s, {
      mode: "existing",
      meal_id: MEAL,
      ingredients: [{ name: "a", quantity: null }, { name: "b", quantity: null }],
    });
    expect(r).toEqual({ ok: false, error: IMPORT_MSG.tooMany(29) });
    expect(inserted()).toBeUndefined();
  });

  it("reports an insert failure", async () => {
    m.insertError = { message: "nope" };
    expect(await saveImportedRecipe(s, { mode: "existing", meal_id: MEAL, ingredients: [{ name: "a", quantity: null }] })).toEqual({
      ok: false,
      error: IMPORT_MSG.saveFailed,
    });
  });
});

describe("saveImportedRecipe: new meal", () => {
  it("creates it through saveMeal (same validation as the meal form), with no prices or supply links", async () => {
    await saveImportedRecipe(s, {
      mode: "new",
      planned_on: "2026-10-26",
      slot: "dinner",
      title: "Tomato pasta",
      notes: "From https://recipes.example/pasta",
      ingredients: [{ name: "Pasta", quantity: "200g" }, { name: "pasta", quantity: "1" }],
    });
    expect(m.saveMeal).toHaveBeenCalledWith(s, {
      planned_on: "2026-10-26",
      slot: "dinner",
      title: "Tomato pasta",
      notes: "From https://recipes.example/pasta",
      ingredients: [{ name: "Pasta", quantity: "200g", unit_price_estimate: null, supply_id: null }],
    });
  });
});

describe("parseImportForm", () => {
  const fd = (o: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  };

  it("reads an existing-meal submission", () => {
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL, imp_name: ["Pasta", " "], imp_quantity: ["200g", "x"] }))).toEqual({
      mode: "existing",
      meal_id: MEAL,
      ingredients: [{ name: "Pasta", quantity: "200g" }],
    });
  });

  it("reads a new-meal submission, blank quantity as null", () => {
    expect(
      parseImportForm(fd({ mode: "new", planned_on: "2026-10-26", slot: "lunch", title: " Soup ", notes: "", imp_name: "Leek", imp_quantity: "" })),
    ).toEqual({ mode: "new", planned_on: "2026-10-26", slot: "lunch", title: "Soup", notes: null, ingredients: [{ name: "Leek", quantity: null }] });
  });

  it("rejects bad input and reports nothing ticked", () => {
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL }))).toBe("none");
    expect(parseImportForm(fd({ mode: "existing", meal_id: "nope", imp_name: "a", imp_quantity: "" }))).toBeNull();
    expect(parseImportForm(fd({ mode: "new", planned_on: "2026-02-31", slot: "dinner", title: "x", imp_name: "a", imp_quantity: "" }))).toBeNull();
    expect(parseImportForm(fd({ mode: "new", planned_on: "2026-10-26", slot: "breakfast", title: "x", imp_name: "a", imp_quantity: "" }))).toBeNull();
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL, imp_name: "a".repeat(61), imp_quantity: "" }))).toBeNull();
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL, imp_name: "a", imp_quantity: "q".repeat(31) }))).toBeNull();
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL, imp_name: ["a", "b"], imp_quantity: "1" }))).toBeNull();
    const many = Array.from({ length: 31 }, (_, i) => `item ${i}`);
    expect(parseImportForm(fd({ mode: "existing", meal_id: MEAL, imp_name: many, imp_quantity: many.map(() => "") }))).toBeNull();
    expect(parseImportForm(fd({ mode: "sideways", meal_id: MEAL, imp_name: "a", imp_quantity: "" }))).toBeNull();
  });
});
