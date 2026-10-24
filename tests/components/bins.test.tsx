// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BinsList } from "@/components/bins/BinsList";
import { BinsCard } from "@/components/home/BinsCard";
import { addDays, groupBins, londonToday } from "@/components/bins/group";

afterEach(cleanup);

const NOW = new Date("2026-10-21T12:00:00Z");

describe("groupBins", () => {
  it("groups by date, drops past days and flags tomorrow", () => {
    const days = groupBins(
      [
        { date: "2026-10-22", bin: "Green" },
        { date: "2026-10-22", bin: "Black" },
        { date: "2026-10-29", bin: "Blue" },
        { date: "2026-10-01", bin: "Old" },
      ],
      NOW,
    );
    expect(days).toEqual([
      { date: "2026-10-22", bins: ["Black", "Green"], putOutTonight: true },
      { date: "2026-10-29", bins: ["Blue"], putOutTonight: false },
    ]);
  });
  it("uses the London date around midnight", () => {
    // 2026-07-01 23:30 UTC is 00:30 on 2 July in London (BST).
    expect(londonToday(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("BinsList", () => {
  it("shows the empty state", () => {
    render(<BinsList days={[]} lastSynced={null} />);
    expect(screen.getByText(/Add your bins once/i)).toBeTruthy();
    expect(screen.queryByText(/Last synced/)).toBeNull();
  });
  it("highlights tonight and formats dates", () => {
    render(<BinsList today="2026-10-21" days={groupBins([{ date: "2026-10-22", bin: "Black bin" }, { date: "2026-10-29", bin: "Blue bin" }], NOW)} lastSynced="2026-10-21T05:00:00Z" />);
    expect(screen.getByText("Put out tonight")).toBeTruthy();
    expect(screen.getByText("Due soon")).toBeTruthy();
    expect(screen.getByText("22/Oct/2026")).toBeTruthy();
    expect(screen.getByText("Black bin")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.getByText(/Last synced 21\/Oct\/2026/)).toBeTruthy();
  });
});

describe("BinsCard", () => {
  it("says no bins added with no rows", () => {
    render(<BinsCard days={[]} />);
    expect(screen.getByText("No bins added yet")).toBeTruthy();
  });
  it("shows the next collection", () => {
    render(<BinsCard days={groupBins([{ date: "2026-10-29", bin: "Blue bin" }], NOW)} />);
    expect(screen.getByText("29/Oct/2026")).toBeTruthy();
    expect(screen.getByText("Blue bin")).toBeTruthy();
    expect(screen.queryByText("Put out tonight")).toBeNull();
  });
  it("shows an error state when unavailable", () => {
    render(<BinsCard days={null} />);
    expect(screen.getByText(/Could not load/)).toBeTruthy();
  });
});
