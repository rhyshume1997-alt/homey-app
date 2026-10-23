// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NotificationList } from "@/components/notifications/NotificationList";
import { NotificationsCard } from "@/components/home/NotificationsCard";
import { groupNotifications, safeLink, type NotificationItem } from "@/components/notifications/types";
import { DEFAULT_DATE_PREFS } from "@/components/dates";

afterEach(cleanup);

const NOW = new Date("2026-10-21T12:00:00Z");
let n = 0;
const item = (o: Partial<NotificationItem>): NotificationItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  kind: "system", title: "T", body: null, link: null, createdAt: "2026-10-21T10:00:00Z", read: false, ...o,
});

describe("safeLink", () => {
  it("allows relative paths only", () => {
    expect(safeLink("/tasks")).toBe("/tasks");
    expect(safeLink("//evil.com")).toBeNull();
    expect(safeLink("https://evil.com")).toBeNull();
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});

describe("groupNotifications", () => {
  it("groups by age with unread first", () => {
    const g = groupNotifications(
      [
        item({ title: "old", createdAt: "2026-09-01T10:00:00Z" }),
        item({ title: "week", createdAt: "2026-10-18T10:00:00Z" }),
        item({ title: "read today", read: true }),
        item({ title: "today" }),
      ],
      NOW,
    );
    expect(g.map((x) => x.label)).toEqual(["Today", "This week", "Earlier"]);
    expect(g[0]!.items.map((i) => i.title)).toEqual(["today", "read today"]);
  });
});

describe("NotificationBell", () => {
  it("links to /notifications with a badge", () => {
    render(<NotificationBell unread={3} />);
    const a = screen.getByRole("link", { name: "Notifications, 3 unread" });
    expect(a.getAttribute("href")).toBe("/notifications");
    expect(a.className).toContain("size-11");
    expect(screen.getByTestId("notification-badge").textContent).toBe("3");
  });
  it("hides the badge at zero", () => {
    render(<NotificationBell unread={0} />);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });
});

describe("NotificationList", () => {
  it("renders unsafe links as plain text", () => {
    render(<NotificationList items={[item({ title: "Evil", link: "//evil.com" }), item({ title: "Good", link: "/tasks" })]} now={NOW} datePrefs={DEFAULT_DATE_PREFS} />);
    expect(screen.queryByRole("link", { name: "Evil" })).toBeNull();
    expect(screen.getByText("Evil")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Good" }).getAttribute("href")).toBe("/tasks");
  });
  it("shows an empty state", () => {
    render(<NotificationList items={[]} now={NOW} datePrefs={DEFAULT_DATE_PREFS} />);
    expect(screen.getByText("No notifications yet.")).toBeTruthy();
  });
});

describe("NotificationsCard", () => {
  it("shows at most 3 unread", () => {
    render(<NotificationsCard items={[item({ title: "a" }), item({ title: "b" }), item({ title: "c" }), item({ title: "d" }), item({ title: "r", read: true })]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("handles load failure", () => {
    render(<NotificationsCard items={null} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
