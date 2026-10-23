import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RecordCategorySchema } from "../../src/contracts/records";
import { buildSql, deriveAmountKind, importKey, planImport, RECORD_CATEGORIES, type MasterRecord } from "../../scripts/import/mapping";

const HH = "11111111-2222-4333-8444-555555555555";
const fixture: MasterRecord = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/master-record.sample.json"), "utf8"));
const plan = planImport(fixture, HH);
const rec = (what: string) => plan.records.find((r) => r.title === what)!;

describe("planImport on the synthetic fixture", () => {
  it("keeps the category list in step with the contract", () => {
    expect([...RECORD_CATEGORIES].sort()).toEqual([...RecordCategorySchema.options].sort());
  });

  it("covers every category in the fixture", () => {
    const cats = new Set(fixture.items.map((i) => i.category));
    for (const c of RECORD_CATEGORIES) expect(cats.has(c)).toBe(true);
    expect(cats.has("snag")).toBe(true);
  });

  it("splits snags from records and never marks snags fixed", () => {
    expect(plan.snags).toHaveLength(3);
    expect(plan.records.every((r) => r.category !== ("snag" as string))).toBe(true);
    expect(plan.snags.some((s) => s.status === "fixed")).toBe(false);
    expect(plan.snags.every((s) => s.location === null)).toBe(true);
    const door = plan.snags[0];
    expect(door.priority).toBe("high");
    expect(door.status).toBe("open");
    expect(door.notes).toContain("Ref: …0042");
    expect(door.notes).toContain("Since: 2024-07-01");
    expect(door.notes).toContain("Provider: Example Homes");
    expect(plan.snags[1].status).toBe("reported");
    expect(plan.snags[2].status).toBe("reported");
    expect(plan.snags[2].notes).not.toContain("Provider");
  });

  it("keeps energy_efficiency as a record", () => {
    expect(plan.records.some((r) => r.category === "energy_efficiency")).toBe(true);
  });

  it("maps unknown provider to null and sets verified false and as_of", () => {
    expect(rec("Title deeds").provider).toBeNull();
    expect(plan.records.every((r) => r.verified === false && r.as_of === "2026-01-15")).toBe(true);
  });

  it("only keeps references of exactly 4 characters and warns otherwise", () => {
    expect(rec("Fixed rate mortgage").reference_last4).toBe("9876");
    expect(rec("Fixed rate mortgage second part").reference_last4).toBeNull();
    expect(rec("Joint account balance").reference_last4).toBeNull();
    expect(plan.warnings.filter((w) => w.includes("reference_last4"))).toHaveLength(2);
    expect(plan.warnings.join("\n")).not.toContain("12345");
  });

  it("derives unit and amount_kind without inventing amounts", () => {
    expect(rec("Fibre broadband")).toMatchObject({ amount: null, unit: null, amount_kind: null });
    expect(rec("Gas usage assessment")).toMatchObject({ unit: "kWh", amount_kind: "estimate" });
    expect(rec("Solar generation")).toMatchObject({ unit: "kWh", amount_kind: "estimate" });
    expect(rec("Fixed rate mortgage")).toMatchObject({ unit: "GBP", amount_kind: "budget" });
    expect(rec("Electricity bill")).toMatchObject({ unit: "GBP", amount_kind: "bill" });
    expect(rec("Joint account balance")).toMatchObject({ amount_kind: "snapshot" });
    expect(rec("Water and sewerage")).toMatchObject({ amount_kind: "estimate" });
    expect(rec("Garden landscaping")).toMatchObject({ amount_kind: "proposal" });
    expect(rec("Purchase price")).toMatchObject({ amount_kind: "contract" });
    expect(rec("Fixed rate mortgage second part")).toMatchObject({ amount_kind: "contract" });
    expect(rec("Emergency fund target").amount_kind).toBeNull();
    expect(deriveAmountKind(null, null, { category: "purchase", what: "x", frequency: "budget", status: null })).toBeNull();
  });

  it("drops invalid dates with a warning", () => {
    expect(rec("Garden landscaping").end_date).toBeNull();
    expect(plan.warnings.some((w) => w.includes("dates.end"))).toBe(true);
  });

  it("creates the expected tasks only", () => {
    const byTitle = Object.fromEntries(plan.tasks.map((t) => [t.title, t]));
    expect(plan.tasks).toHaveLength(4);
    expect(byTitle["Compare home insurance renewal quotes"].due_date).toBe("2026-08-13");
    expect(byTitle["Compare energy tariffs before fixed deal ends"].due_date).toBe("2026-02-17");
    expect(byTitle["Review mortgage before fixed rate ends"].due_date).toBe("2029-01-01");
    expect(byTitle["Book annual boiler service"].due_date).toBe("2026-05-01");
    expect(byTitle["Book annual boiler service"].recurrence).toBe("yearly");
    expect(plan.tasks.filter((t) => t.title !== "Book annual boiler service").every((t) => t.recurrence === "none")).toBe(true);
    expect(plan.tasks.every((t) => t.household_id === HH)).toBe(true);
    expect(plan.warnings.some((w) => w.includes("annual recurrence is not supported"))).toBe(false);
    expect(plan.warnings.some((w) => w.includes("insurance has no renewal date"))).toBe(true);
  });

  it("falls back to start + 1 year for a boiler task and warns when no date", () => {
    const base = { as_of: "2026-01-15", items: [{ category: "maintenance", what: "Boiler check", dates: { start: "2025-02-28" } }] };
    expect(planImport(base, HH).tasks[0].due_date).toBe("2026-02-28");
    const none = planImport({ ...base, items: [{ category: "maintenance", what: "Boiler check" }] }, HH);
    expect(none.tasks).toHaveLength(0);
    expect(none.warnings.some((w) => w.includes("no usable"))).toBe(true);
  });

  it("returns the household block separately and never puts the address in a row", () => {
    expect(plan.household).toMatchObject({ address: "1 Test Street, Exampletown, EX1 1AA" });
    expect(JSON.stringify([plan.records, plan.snags, plan.tasks])).not.toContain("1 Test Street");
  });

  it("is deterministic with stable unique import keys", () => {
    expect(planImport(fixture, HH)).toEqual(plan);
    const keys = plan.records.map((r) => r.import_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^mr1:[0-9a-f]{32}$/.test(k!))).toBe(true);
    expect(importKey("gas", "A", "b")).toBe(importKey("gas", "A", "b"));
    expect(importKey("gas", "A", "b")).not.toBe(importKey("gas", "A", "c"));
  });

  it("skips duplicate items and truncates over-long snag titles", () => {
    const item = { category: "contact", provider: "P", what: "W" };
    const r = planImport({ as_of: "2026-01-15", items: [item, item, { category: "snag", what: "x".repeat(300) }] }, HH);
    expect(r.records).toHaveLength(1);
    expect(r.snags[0].title).toHaveLength(200);
    expect(r.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });
});

describe("buildSql", () => {
  const sql = buildSql(plan);

  it("is one transaction with idempotent inserts", () => {
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("on conflict (household_id, import_key) do nothing;");
    expect(sql.match(/insert into public\.snags/g)).toHaveLength(3);
    expect(sql.match(/insert into public\.tasks/g)).toHaveLength(4);
    expect(sql.match(/where not exists/g)).toHaveLength(7);
    expect(sql).not.toContain("created_by");
  });

  it("doubles single quotes and keeps nulls as null", () => {
    expect(sql).toContain("'Driveway crack, it''s growing'");
    expect(sql).toMatch(/null, null, null/);
  });

  it("rejects bad inputs", () => {
    expect(() => buildSql({ ...plan, tasks: [{ ...plan.tasks[0], household_id: "x'; drop table" }] })).toThrow();
    expect(() => buildSql({ ...plan, records: [{ ...plan.records[0], amount: Number.NaN }] })).toThrow();
    expect(() => buildSql({ ...plan, records: [{ ...plan.records[0], start_date: "2026-13-01" }] })).toThrow();
    expect(() => buildSql({ ...plan, records: [{ ...plan.records[0], reference_last4: "12345" }] })).toThrow();
  });
});

describe("deriveUnit regression (real record shape)", () => {
  it("a bill whose description mentions kWh is still in pounds", async () => {
    const { deriveUnit } = await import("../../scripts/import/mapping");
    expect(deriveUnit(42.17, "billing period", "300.5 kWh import, 200.5 night and 100.0 standard")).toBe("GBP");
    expect(deriveUnit(900, "kWh over assessment period", "Gas usage assessment")).toBe("kWh");
    expect(deriveUnit(649, "kWh per year estimated", "1.34 kW PV")).toBe("kWh");
    expect(deriveUnit(null, "billing period", "x")).toBeNull();
  });
});
