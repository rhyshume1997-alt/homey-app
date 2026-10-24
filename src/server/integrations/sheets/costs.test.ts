import { describe, expect, it } from "vitest";
import fixture from "../../../../tests/fixtures/costs-sheet.json";
import { parseCosts, reconcile, type Flag } from "./costs";
import type { Cell } from "./google";

const values = fixture.values as Cell[][];
const sheet = () => parseCosts(values, fixture.formulas as Cell[][]);
const find = (flags: Flag[], row: number, column: string) => flags.filter((f) => f.row === row && f.column === column);

describe("parseCosts", () => {
  it("parses the fixture layout", () => {
    const s = sheet();
    expect(s.bills).toHaveLength(11);
    expect(s.bills[0]).toMatchObject({ name: "Mortgage", amount: 1000, shares: [500, 500], note: null, row: 2 });
    expect(s.bills[4]!.note).toBe("After 15 months goes to £35");
    expect(s.bills[6]).toMatchObject({ name: "Life insurance", amount: null, shares: [50, 30] });
    expect(s.summary.total).toMatchObject({ amount: 1850, shares: [925, 925] });
    expect(s.summary.totalPcm).toMatchObject({ amount: 1500, shares: [760, 750] });
    expect(s.summary.jointAccountTotal).toMatchObject({ amount: null, shares: [752, 750] });
    expect(s.payIntoLabel).toBe("-> Pay into Joint Account");
  });

  it("is robust to header variations, string money, blank rows and short rows", () => {
    const s = parseCosts([
      ["BILL", "amount (£)", "ALEX", "sam", "Notes"],
      [],
      ["Rent", "£1,000.50", "500.25", "500.25", "x"],
      ["", "", ""],
      ["Water"],
      ["total", 1000.5],
    ]);
    expect(s.bills.map((b) => b.name)).toEqual(["Rent", "Water"]);
    expect(s.bills[0]).toMatchObject({ amount: 1000.5, shares: [500.25, 500.25], note: "x" });
    expect(s.bills[1]).toMatchObject({ amount: null, shares: [null, null] });
    expect(s.summary.total?.amount).toBe(1000.5);
  });

  it("handles an empty sheet", () => {
    expect(parseCosts([]).bills).toEqual([]);
  });

  it("captures formulas", () => {
    const f = values.map((r) => [...r]);
    f[1] = ["Mortgage", "=B2", "=B2/2", 500];
    const s = parseCosts(values, f);
    expect(s.bills[0]!.formulas).toEqual({ amount: "=B2", shares: { 0: "=B2/2" } });
  });
});

describe("dynamic share columns", () => {
  it("1 share column", () => {
    const s = parseCosts([["Bills", "Amount", "Pat", "Notes"], ["Rent", 100, 100, "n"], ["Food", 50, 40], ["Total", 150, 140]]);
    expect(s.shareLabels).toEqual(["Pat"]);
    expect(s.bills[0]).toMatchObject({ shares: [100], note: "n" });
    const f = reconcile(s);
    expect(find(f, 3, "Amount")[0]!.explanation).toContain("Food: Amount £50 but Pat £40 = £40");
    expect(find(f, 4, "Amount")).toHaveLength(1);
  });

  it("3 share columns sum across all", () => {
    const v: Cell[][] = [["Bills", "Amount", "A", "B", "C", "Changes?"], ["Rent", 90, 30, 30, 20, "x"], ["Total", 90, 30, 30, 30]];
    const s = parseCosts(v);
    expect(s.shareLabels).toEqual(["A", "B", "C"]);
    expect(s.bills[0]).toMatchObject({ shares: [30, 30, 20], note: "x" });
    const f = reconcile(s);
    expect(find(f, 2, "Amount")[0]!.explanation).toContain("A £30 + B £30 + C £20 = £80");
    expect(find(f, 3, "C")[0]).toMatchObject({ expected: 20, actual: 30 });
    expect(find(f, 3, "A")).toHaveLength(0);
  });

  it("uses a renamed header in labels and flags", () => {
    const v: Cell[][] = [["Bills", "Amount", "Jo (50%)", "Kit", "Notes"], ["Food", 100, 30, 30], ["Total", 100, 30, 30]];
    const s = parseCosts(v);
    expect(s.shareLabels).toEqual(["Jo (50%)", "Kit"]);
    const f = reconcile(s);
    expect(f[0]!.explanation).toContain("Jo (50%) £30 + Kit £30 = £60");
    expect(find(f, 3, "Amount")[0]!.explanation).toContain("Jo (50%) £30 + Kit £30");
  });

  it("blank share cells are not zero-filled and do not trigger the sum check", () => {
    const v: Cell[][] = [["Bills", "Amount", "A", "B", "C"], ["Rent", 90, 45, "", 45], ["Gas", "", "", 10, ""], ["Total", 90, 45, 10, 45]];
    const s = parseCosts(v);
    expect(s.bills[0]!.shares).toEqual([45, null, 45]);
    const f = reconcile(s);
    expect(find(f, 2, "Amount")).toHaveLength(0);
    expect(find(f, 3, "Amount")[0]!.explanation).toContain("Amount is blank but shares are present");
    expect(find(f, 4, "B")).toHaveLength(0);
  });

  it("falls back to a single Share column when the header has none", () => {
    expect(parseCosts([["Bills", "Amount", "Notes"], ["Rent", 5]]).shareLabels).toEqual(["Share"]);
    expect(parseCosts([]).shareLabels).toEqual(["Share"]);
  });
});

describe("reconcile on the fixture", () => {
  const flags = reconcile(sheet());

  it("(a) flags Food and House insurance with arithmetic, wording as a possibility", () => {
    const food = find(flags, 5, "Amount");
    expect(food).toHaveLength(1);
    expect(food[0]).toMatchObject({ expected: 280, actual: 250, difference: -30 });
    const ins = find(flags, 7, "Amount")[0]!;
    expect(ins).toMatchObject({ expected: 25, actual: 300, difference: 275 });
    expect(ins.explanation).toMatch(/could be an annual/);
    expect(ins.explanation).toContain("£300 / 12 = £25");
  });

  it("does not flag rows that balance", () => {
    expect(flags.filter((f) => [2, 3, 4, 6, 9, 10, 11, 12].includes(f.row) && f.row !== 12)).toEqual([]);
  });

  it("(b) flags Life insurance with blank amount", () => {
    const l = find(flags, 8, "Amount")[0]!;
    expect(l).toMatchObject({ expected: 80, actual: null, difference: null });
    expect(l.explanation).toContain("blank");
  });

  it("(c) Total row vs sum of bills per column", () => {
    const t = find(flags, 13, "Amount")[0]!;
    expect(t).toMatchObject({ expected: 2050, actual: 1850, difference: -200 });
    expect(t.explanation).toContain("Life insurance");
    expect(find(flags, 13, "Member A")[0]).toMatchObject({ expected: 987.5, actual: 925, difference: -62.5 });
    expect(find(flags, 13, "Member B")).toHaveLength(1);
  });

  it("(d) Total PCM and Joint Account Total", () => {
    expect(find(flags, 14, "Amount")).toEqual(expect.arrayContaining([expect.objectContaining({ expected: 1510, actual: 1500, difference: -10 }), expect.objectContaining({ expected: 1850, actual: 1500, difference: -350 })]));
    expect(find(flags, 14, "Member A")[0]!.explanation).toMatch(/Bills add up to £987.5/);
    expect(find(flags, 15, "Member A")[0]).toMatchObject({ expected: 760, actual: 752, difference: -8 });
    expect(find(flags, 15, "Member B")).toHaveLength(0);
  });

  it("flags are sorted by row and never alter the sheet", () => {
    expect(flags.map((f) => f.row)).toEqual([...flags.map((f) => f.row)].sort((a, b) => a - b));
    expect(sheet().bills[3]!.amount).toBe(250);
  });
});

describe("reconcile edge rules", () => {
  const base = (): Cell[][] => [
    ["Bills", "Amount", "Member A", "Member B"],
    ["A", 10, 5, 5],
    ["B", 20, 10, 10],
    ["C", 30, 15, 15],
    ["Total", 60, 30, 30],
  ];

  it("no flags for a consistent sheet", () => {
    expect(reconcile(parseCosts(base()))).toEqual([]);
  });

  it("compares to the penny", () => {
    const v = base();
    v[1] = ["A", 10, 5, 4.99];
    const f = reconcile(parseCosts(v));
    expect(find(f, 2, "Amount")[0]).toMatchObject({ expected: 9.99, actual: 10, difference: 0.01 });
  });

  it("does not suggest annual when ratio is small", () => {
    const v = base();
    v[1] = ["A", 11, 5, 5];
    expect(find(reconcile(parseCosts(v)), 2, "Amount")[0]!.explanation).not.toMatch(/annual/);
  });

  it("(e) formula referencing outside the table or another sheet", () => {
    const v = base();
    const f = base();
    f[4] = ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)+K9", "=Other!C2"];
    const flags = reconcile(parseCosts(v, f));
    expect(find(flags, 5, "Amount")).toHaveLength(0);
    expect(find(flags, 5, "Member A")[0]!.explanation).toContain("K9");
    expect(find(flags, 5, "Member B")[0]!.explanation).toContain("another sheet");
  });

  it("(e) hard-coded number between formula neighbours", () => {
    const v = base();
    const f = base();
    f[1] = ["A", 10, "=B2/2", 5];
    f[2] = ["B", 20, 10, 10];
    f[3] = ["C", 30, "=B4/2", 15];
    const flags = reconcile(parseCosts(v, f));
    const hit = find(flags, 3, "Member A");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.explanation).toMatch(/typed number/);
    expect(find(flags, 3, "Member B")).toHaveLength(0);
  });
});
