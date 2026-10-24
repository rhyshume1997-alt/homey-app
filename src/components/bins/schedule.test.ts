import { describe, expect, it } from "vitest";
import { mergeBinDays, scheduleDates } from "./schedule";

const sch = (first_date: string, every_weeks: number, bin_name = "Green bin") =>
  ({ id: "1", bin_name, colour: "green" as const, first_date, every_weeks });

describe("scheduleDates", () => {
  it("every week gives 8 dates", () => {
    const d = scheduleDates(sch("2026-10-01", 1), "2026-10-24");
    expect(d).toHaveLength(8);
    expect(d[0]).toBe("2026-10-29");
    expect(d[7]).toBe("2026-12-17");
  });
  it("every 2 weeks from the past stays on the cycle", () => {
    expect(scheduleDates(sch("2026-10-01", 2), "2026-10-24")).toEqual(["2026-10-29", "2026-11-12", "2026-11-26", "2026-12-10"]);
  });
  it("every 3 weeks", () => {
    expect(scheduleDates(sch("2026-10-24", 3), "2026-10-24")).toEqual(["2026-10-24", "2026-11-14", "2026-12-05"]);
  });
  it("a future first date starts there", () => {
    expect(scheduleDates(sch("2026-11-10", 2), "2026-10-24")).toEqual(["2026-11-10", "2026-11-24", "2026-12-08"]);
  });
  it("a first date beyond the window gives nothing", () => {
    expect(scheduleDates(sch("2027-03-01", 1), "2026-10-24")).toEqual([]);
  });
  it("today counts, yesterday does not", () => {
    expect(scheduleDates(sch("2026-10-24", 8), "2026-10-24")[0]).toBe("2026-10-24");
    expect(scheduleDates(sch("2026-10-23", 8), "2026-10-24")[0]).toBe("2026-12-18");
  });
  it("keeps the same weekday across the clocks going back (25 Oct 2026) and forward (28 Mar 2027)", () => {
    const back = scheduleDates(sch("2026-10-15", 1), "2026-10-20");
    expect(back.slice(0, 3)).toEqual(["2026-10-22", "2026-10-29", "2026-11-05"]);
    const fwd = scheduleDates(sch("2027-03-18", 1), "2027-03-20");
    expect(fwd.slice(0, 3)).toEqual(["2027-03-25", "2027-04-01", "2027-04-08"]);
    for (const d of [...back, ...fwd]) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(4);
  });
});

describe("mergeBinDays", () => {
  // 23:30 UTC on 24 Oct 2026 is still 24 Oct in London (BST); 00:30 on the 25th UTC is 00:30 GMT.
  const now = new Date("2026-10-24T12:00:00Z");
  it("merges, de-duplicates by date and name, sorts and flags tonight", () => {
    const days = mergeBinDays(
      [sch("2026-10-25", 2, "Green bin"), sch("2026-10-31", 1, "Brown bin")],
      [{ date: "2026-10-25", bin: "green bin" }, { date: "2026-10-25", bin: "Grey bin" }, { date: "2026-10-01", bin: "Past" }],
      now,
    );
    expect(days[0]?.bins).toHaveLength(2); // the pushed "green bin" wins over the schedule's "Green bin"
    expect(days[0]?.putOutTonight).toBe(true);
    expect(days[1]?.date).toBe("2026-10-31");
    expect(days.some((d) => d.bins.includes("Past"))).toBe(false);
    expect(days.filter((d) => d.date === "2026-10-25")).toHaveLength(1);
  });
  it("pushed rows alone still work, and empty gives empty", () => {
    expect(mergeBinDays([], [{ date: "2026-10-30", bin: "X" }], now)).toHaveLength(1);
    expect(mergeBinDays([], [], now)).toEqual([]);
  });
});
