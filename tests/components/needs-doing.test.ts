import { describe, expect, it } from "vitest";
import {
  computeNeedEntries, computeNeedsDoing, countNeeds, worstLightFor, NEED_ROUTES, type NeedsInput,
} from "@/components/homey/needs-doing";

const today = "2026-10-21";
const base: NeedsInput = { tasks: [], snags: [], records: [], bins: [], maintenance: [], supplies: [], today };
const run = (o: Partial<NeedsInput>) => computeNeedsDoing({ ...base, ...o });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (n: number, due: string | null, o: Record<string, unknown> = {}) =>
  ({ id: id(n), title: `Task ${n}`, notes: null, status: "open" as const, due_date: due, ...o });
const rec = (n: number, o: Record<string, unknown> = {}) =>
  ({ id: id(n), title: "Gas tariff", provider: null, amount: null, verified: true, renewal_date: null, end_date: null, ...o });
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("tasks", () => {
  it("buckets overdue, today, soon with lights and an open action", () => {
    const items = run({ tasks: [task(1, "2026-10-20"), task(2, today), task(3, "2026-10-22")] });
    expect(items.map((i) => [i.key, i.bucket, i.light])).toEqual([
      [`task:${id(1)}`, "overdue", "red"],
      [`task:${id(2)}`, "today", "amber"],
      [`task:${id(3)}`, "soon", "amber"],
    ]);
    expect(items[0].action).toEqual({ type: "open", href: "/tasks", label: "Open tasks" });
  });
  it("includes 7 days, excludes 8 days, no date and done tasks", () => {
    const items = run({
      tasks: [task(1, add(today, 7)), task(2, add(today, 8)), task(3, null), task(4, "2026-10-01", { status: "done" })],
    });
    expect(items.map((i) => i.key)).toEqual([`task:${id(1)}`]);
  });
});

describe("bins", () => {
  it("tomorrow reads as out tonight, today as collected today, later is ignored", () => {
    const items = run({
      bins: [
        { date: "2026-10-22", bins: ["Blue", "Green"] },
        { date: today, bins: ["Black"] },
        { date: "2026-10-23", bins: ["Brown"] },
      ],
    });
    expect(items.map((i) => i.text)).toEqual(["Bins collected today: Black", "Bins out tonight: Blue, Green"]);
    expect(items.every((i) => i.bucket === "today" && i.light === "amber" && i.href === "/bins")).toBe(true);
    expect(items[1].key).toBe("bins:2026-10-22");
  });
});

describe("maintenance", () => {
  it("past is overdue, today, 7 days is soon, 8 days is ignored; action proposes a task", () => {
    const items = run({
      maintenance: [
        { id: id(1), title: "Bleed radiators", next_due_on: "2026-10-01" },
        { id: id(2), title: "Clean gutters", next_due_on: today },
        { id: id(3), title: "Smoke alarms", next_due_on: add(today, 7) },
        { id: id(4), title: "Too far", next_due_on: add(today, 8) },
        { id: id(5), title: "No date", next_due_on: null },
      ],
    });
    expect(items.map((i) => [i.bucket, i.light])).toEqual([["overdue", "red"], ["today", "amber"], ["soon", "amber"]]);
    expect(items[0].action).toEqual({ type: "propose_task", label: "Do: Bleed radiators" });
    const entries = computeNeedEntries({ ...base, maintenance: [{ id: id(1), title: "Bleed radiators", next_due_on: "2026-10-01" }] });
    expect(entries[0].proposal).toEqual({ kind: "create_task", payload: { title: "Do: Bleed radiators", due_date: today } });
  });
});

describe("renewals", () => {
  it("includes 30 days, excludes 31 days and past dates", () => {
    const items = run({
      records: [
        rec(1, { renewal_date: add(today, 30) }),
        rec(2, { renewal_date: add(today, 31) }),
        rec(3, { renewal_date: "2026-10-20" }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([`renewal:${id(1)}`]);
    expect(items[0].bucket).toBe("soon");
    expect(items[0].text).toBe("Gas tariff renews in 30 days");
  });
  it("uses end_date when there is no renewal date", () => {
    expect(run({ records: [rec(1, { end_date: "2026-10-22" })] })[0].text).toBe("Gas tariff ends tomorrow");
  });
  it("is skipped when an open task mentions it, but not when that task is done", () => {
    const r = [rec(1, { renewal_date: "2026-11-10" })];
    expect(run({ records: r, tasks: [task(1, null, { title: "Review gas tariff" })] })).toEqual([]);
    expect(run({ records: r, tasks: [task(1, null, { title: "Review gas tariff", status: "done" })] })).toHaveLength(1);
  });
  it("proposes a review task 14 days before, or today if that is closer", () => {
    const far = computeNeedEntries({ ...base, records: [rec(1, { renewal_date: "2026-11-20" })] })[0];
    expect(far.proposal).toEqual({ kind: "create_task", payload: { title: "Review Gas tariff renewal", due_date: "2026-11-06" } });
    expect(far.item.action).toEqual({ type: "propose_task", label: "Review Gas tariff renewal" });
    const near = computeNeedEntries({ ...base, records: [rec(1, { renewal_date: "2026-10-25" })] })[0];
    expect(near.proposal?.payload).toEqual({ title: "Review Gas tariff renewal", due_date: today });
  });
  it("never exposes amounts, providers or references in text", () => {
    const items = run({ records: [rec(1, { renewal_date: "2026-11-01", provider: "Octopus", amount: 123.45 })] });
    expect(JSON.stringify(items)).not.toMatch(/Octopus|123/);
  });
});

describe("figures, snags, supplies", () => {
  it("counts unverified figures (ignoring null amounts)", () => {
    const items = run({ records: [rec(1, { amount: 5, verified: false }), rec(2, { amount: 6, verified: false }), rec(3, { verified: false })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "figures", bucket: "check", href: "/money/check", text: "2 figures are still unverified" });
  });
  it("flags snags open over 30 days only (30 no, 31 yes), never fixed ones", () => {
    const s = (created: string, status = "open") => ({ id: id(1), status: status as "open", created_at: `${created}T09:00:00Z` });
    expect(run({ snags: [s(add(today, -30))] })).toEqual([]);
    expect(run({ snags: [s(add(today, -31)), s("2026-01-01", "fixed")] })[0]).toMatchObject({
      key: "snags", bucket: "check", href: "/snags", text: "1 snag has been open over 30 days",
    });
  });
  it("proposes shopping for low and out supplies, not ok ones", () => {
    const supplies = [
      { id: id(1), name: "Bin bags", status: "low" as const },
      { id: id(2), name: "Salt", status: "out" as const },
      { id: id(3), name: "Soap", status: "ok" as const },
    ];
    const entries = computeNeedEntries({ ...base, supplies });
    expect(entries.map((e) => e.item.key)).toEqual([`supply:${id(1)}`, `supply:${id(2)}`]);
    expect(entries[1].item.action?.type).toBe("propose_shopping");
    expect(entries[1].proposal).toEqual({ kind: "add_shopping_item", payload: { title: "Salt" } });
  });
});

describe("ordering, keys, safety", () => {
  it("orders overdue, today, soon, check and has unique keys", () => {
    const items = run({
      tasks: [task(1, "2026-10-25"), task(2, "2026-10-01"), task(3, today)],
      records: [rec(4, { amount: 1, verified: false })],
    });
    expect(items.map((i) => i.bucket)).toEqual(["overdue", "today", "soon", "check"]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
  it("every href is a fixed internal route", () => {
    const items = run({
      tasks: [task(1, today)], bins: [{ date: today, bins: ["//evil.example"] }],
      maintenance: [{ id: id(2), title: "x", next_due_on: today }],
      records: [rec(3, { renewal_date: "2026-11-01", amount: 1, verified: false, title: "https://evil.example" })],
      supplies: [{ id: id(4), name: "javascript:alert(1)", status: "out" }],
      snags: [{ id: id(5), status: "open", created_at: "2026-01-01T00:00:00Z" }],
    });
    const routes = new Set<string>(Object.values(NEED_ROUTES));
    for (const i of items) {
      for (const h of [i.href, ...(i.action?.type === "open" ? [i.action.href] : [])]) {
        expect(routes.has(h)).toBe(true);
        expect(h.startsWith("/") && !h.startsWith("//")).toBe(true);
      }
    }
  });
  it("worstLightFor and countNeeds", () => {
    expect(worstLightFor([])).toBe("green");
    const items = run({
      tasks: [task(1, "2026-10-01"), task(2, add(today, 3))],
      records: [rec(3, { renewal_date: add(today, 7) }), rec(4, { title: "Insurance", renewal_date: add(today, 8) })],
      supplies: [{ id: id(5), name: "Salt", status: "low" }],
    });
    expect(worstLightFor(items)).toBe("red");
    // overdue task + the renewal at 7 days; the 3-day task, the 8-day renewal and the supply are not counted.
    expect(countNeeds(items, today)).toBe(2);
  });
});
