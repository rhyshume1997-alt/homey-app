import { describe, expect, it } from "vitest";
import { DEFAULT_DATE_PREFS, formatDate, parseDatePrefs } from "@/components/dates";

describe("formatDate", () => {
  const d = "2026-10-05";
  it.each([
    [{ order: "DMY", month: "short" }, "05/Oct/2026"],
    [{ order: "DMY", month: "numeric" }, "05/10/2026"],
    [{ order: "DMY", month: "long" }, "5 October 2026"],
    [{ order: "MDY", month: "long" }, "October 5 2026"],
    [{ order: "MDY", month: "numeric" }, "10/05/2026"],
    [{ order: "MDY", month: "short" }, "Oct/05/2026"],
    [{ order: "YMD", month: "numeric" }, "2026-10-05"],
    [{ order: "YMD", month: "short" }, "2026/Oct/05"],
    [{ order: "YMD", month: "long" }, "2026 October 5"],
  ] as const)("%o -> %s", (prefs, expected) => {
    expect(formatDate(d, prefs)).toBe(expected);
  });

  it("matches Alex's examples", () => {
    expect(formatDate("2026-10-21", { order: "DMY", month: "long" })).toBe("21 October 2026");
    expect(formatDate("2026-10-21", { order: "YMD", month: "numeric" })).toBe("2026-10-21");
    expect(formatDate("2026-10-21")).toBe("21/Oct/2026");
  });
  it("defaults to UK DD/MMM/YYYY", () => {
    expect(formatDate("2026-09-21")).toBe("21/Sep/2026");
  });

  it("shows timestamps in UK time, with time when asked", () => {
    // 23:30 UTC on 21 Oct is 00:30 BST on 22 Oct.
    expect(formatDate("2026-10-21T23:30:00Z", DEFAULT_DATE_PREFS, true)).toBe("22/Oct/2026, 00:30");
    expect(formatDate("2026-12-01T09:05:00Z", { order: "YMD", month: "numeric" }, true)).toBe("2026-12-01, 09:05");
  });

  it("returns empty for invalid input", () => {
    expect(formatDate("not a date")).toBe("");
  });
});

describe("parseDatePrefs", () => {
  it("accepts valid values", () => {
    expect(parseDatePrefs({ date_order: "MDY", date_month: "long" })).toEqual({ order: "MDY", month: "long" });
  });
  it.each([null, undefined, "x", {}, { date_order: "DROP TABLE", date_month: 3 }, { date_order: "__proto__" }])(
    "falls back to the default for %o",
    (meta) => {
      expect(parseDatePrefs(meta)).toEqual(DEFAULT_DATE_PREFS);
    },
  );
});

describe("formatDate month names (cached tables match Intl)", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("month %i", (m) => {
    const ymd = `2026-${String(m).padStart(2, "0")}-15`;
    const at = new Date(Date.UTC(2000, m - 1, 1));
    expect(formatDate(ymd, { order: "DMY", month: "long" })).toBe(`15 ${at.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} 2026`);
    expect(formatDate(ymd, { order: "DMY", month: "short" })).toBe(`15/${at.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}/2026`);
  });

  it("formats timestamps in UK time, repeatedly, with one shared formatter", () => {
    for (let i = 0; i < 3; i++) {
      expect(formatDate("2026-07-01T23:30:00Z", { order: "DMY", month: "short" }, true)).toBe("02/Jul/2026, 00:30");
      expect(formatDate("2026-12-01T23:30:00Z", { order: "DMY", month: "short" }, true)).toBe("01/Dec/2026, 23:30");
    }
  });
});
