// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ActivityList } from "@/components/activity/ActivityList";
import { activityText, parseBefore, relativeTime, type ActivityRow } from "@/components/activity/format";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);
const now = new Date("2026-10-21T12:00:00Z");
const row = (o: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "5", action: "task.completed", entityType: "task", summary: "Clean oven",
  createdAt: "2026-10-21T11:30:00Z", actorName: "Sam", ...o,
});

describe("activity phrasing", () => {
  it("builds sentences from action and summary", () => {
    expect(activityText(row())).toBe("Sam completed task 'Clean oven'");
    expect(activityText(row({ action: "snag.fixed", entityType: "snag", summary: "Tile" }))).toBe("Sam marked as fixed snag 'Tile'");
    expect(activityText(row({ action: "task.created", summary: null }))).toBe("Sam added a task");
    expect(activityText(row({ action: "weird.thing", entityType: "x" }))).toBe("Sam changed item 'Clean oven'");
  });
  it("phrases household events from the label, with optional note", () => {
    const ev = (summary: string | null) => row({ action: "household.event", entityType: "event", summary });
    expect(activityText(ev("Put a washing on"))).toBe("Sam put a washing on");
    expect(activityText(ev("Bought supplies: milk"))).toBe("Sam bought supplies (milk)");
    expect(activityText(ev("Something else"))).toBe("Sam logged a household event");
    expect(activityText(ev(null))).toBe("Sam logged a household event");
  });
  it("phrases the newer actions without amounts or references", () => {
    const a = (action: string, summary: string | null) => row({ action, entityType: "x", summary });
    expect(activityText(a("shopping.bought", "Milk"))).toBe("Sam bought 'Milk'");
    expect(activityText(a("record.verified", "Broadband"))).toBe("Sam marked verified: 'Broadband'");
    expect(activityText(a("record.created", "Council tax"))).toBe("Sam added record 'Council tax'");
    expect(activityText(a("maintenance.done", "Boiler service"))).toBe("Sam marked maintenance done: 'Boiler service'");
    expect(activityText(a("document.deleted", "Deeds"))).toBe("Sam deleted document 'Deeds'");
    expect(activityText(a("supply.status_changed", "Bin bags"))).toBe("Sam changed the stock level of 'Bin bags'");
    expect(activityText(a("bins.synced", "8 dates"))).toBe("Sam updated the bin dates");
    expect(activityText(a("email.synced", "Alex: 4 threads"))).toBe("Sam synced email threads");
    expect(activityText(a("email.status_changed", "Re: refund"))).toBe("Sam changed the status of an email thread");
    expect(activityText(a("budget.snapshot_saved", "£1,200"))).toBe("Sam saved a budget snapshot");
    expect(activityText(a("ai.proposed", "task: Call plumber"))).toBe("Sam received an assistant suggestion");
    expect(activityText(a("ai.confirmed", "task: Call plumber"))).toBe("Sam confirmed an assistant suggestion");
    expect(activityText(a("ai.rejected", "x"))).toBe("Sam dismissed an assistant suggestion");
  });

  it("phrases the D18 module actions", () => {
    const a = (action: string, summary: string | null) => row({ action, entityType: "x", summary });
    expect(activityText(a("room.created", "Kitchen"))).toBe("Sam added room 'Kitchen'");
    expect(activityText(a("room.updated", "Kitchen"))).toBe("Sam updated room 'Kitchen'");
    expect(activityText(a("room.deleted", "WC"))).toBe("Sam deleted room 'WC'");
    expect(activityText(a("checklist.added", "Clear gutters"))).toBe("Sam added checklist item 'Clear gutters'");
    expect(activityText(a("checklist.updated", "Clear gutters"))).toBe("Sam updated checklist item 'Clear gutters'");
    expect(activityText(a("checklist.done", "Bleed radiators"))).toBe("Sam ticked off 'Bleed radiators'");
    expect(activityText(a("checklist.removed", "Clear gutters"))).toBe("Sam removed checklist item 'Clear gutters'");
    expect(activityText(a("wishlist.added", "Lamp"))).toBe("Sam added to things to get: 'Lamp'");
    expect(activityText(a("wishlist.updated", "Lamp"))).toBe("Sam updated thing to get 'Lamp'");
    expect(activityText(a("wishlist.bought", "Lamp"))).toBe("Sam marked as bought: 'Lamp'");
    expect(activityText(a("wishlist.removed", "Lamp"))).toBe("Sam removed from things to get: 'Lamp'");
    expect(activityText(a("emergency.added", "Stopcock"))).toBe("Sam added emergency info 'Stopcock'");
    expect(activityText(a("emergency.updated", "Stopcock"))).toBe("Sam updated emergency info 'Stopcock'");
    expect(activityText(a("emergency.removed", "Stopcock"))).toBe("Sam removed emergency info 'Stopcock'");
    expect(activityText(a("wifi.added", "Home Guest"))).toBe("Sam added wifi network 'Home Guest'");
    expect(activityText(a("wifi.updated", "Home Guest"))).toBe("Sam updated wifi network 'Home Guest'");
    expect(activityText(a("wifi.removed", "Home Guest"))).toBe("Sam removed wifi network 'Home Guest'");
    expect(activityText(a("event.created", "Dentist"))).toBe("Sam added calendar event 'Dentist'");
    expect(activityText(a("event.updated", "Dentist"))).toBe("Sam updated calendar event 'Dentist'");
    expect(activityText(a("event.deleted", "Dentist"))).toBe("Sam deleted calendar event 'Dentist'");
    expect(activityText(a("appliance.created", "Boiler"))).toBe("Sam added appliance 'Boiler'");
    expect(activityText(a("appliance.updated", "Boiler"))).toBe("Sam updated appliance 'Boiler'");
    expect(activityText(a("appliance.deleted", "Boiler"))).toBe("Sam deleted appliance 'Boiler'");
    expect(activityText(a("meter_reading.added", "gas 2026-10-01"))).toBe("Sam added a gas meter reading");
    expect(activityText(a("meter_reading.updated", "electricity 2026-10-01"))).toBe("Sam updated an electricity meter reading");
    expect(activityText(a("meter_reading.removed", "odd"))).toBe("Sam removed a meter reading");
  });

  it("formats relative time", () => {
    expect(relativeTime("2026-10-21T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-19T12:00:00Z", now)).toBe("2 d ago");
  });
});

describe("parseBefore", () => {
  it("accepts only integers", () => {
    expect(parseBefore("42")).toBe(42);
    for (const bad of ["abc", "1.5", "-3", "0", "1e3", "", " 4", "4; drop", undefined, ["1", "2"]]) {
      expect(parseBefore(bad as string)).toBeNull();
    }
  });
});

describe("ActivityList", () => {
  it("renders rows, escapes titles, shows no JSON, and links to older", () => {
    render(<ActivityList rows={[row({ summary: "<b>x</b>" })]} now={now} nextBefore="5" />);
    expect(screen.getByText(/Sam/).closest("li")?.textContent).toContain("<b>x</b>");
    expect(screen.getByRole("link", { name: "Older activity" }).getAttribute("href")).toBe("/activity?before=5");
    expect(document.body.textContent).not.toMatch(/before|after":/);
  });
  it("omits pagination on the last page and handles empty and error", () => {
    const { rerender } = render(<ActivityList rows={[row()]} now={now} nextBefore={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<ActivityList rows={[]} now={now} nextBefore={null} />);
    expect(screen.getByText("No activity yet.")).toBeTruthy();
    rerender(<ActivityList rows={[]} now={now} nextBefore={null} error />);
    expect(screen.getByText(/Could not load activity/)).toBeTruthy();
  });
});
