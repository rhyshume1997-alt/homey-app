// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QuickAdd, QUICK_ACTIONS } from "@/components/QuickAdd";
import { AppNav } from "@/components/AppNav";
import { NAV_ITEMS } from "@/components/nav-items";
import { NotificationBell } from "@/components/notifications/NotificationBell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/app/(house)/quick-add-actions", () => ({ logEventAction: vi.fn(), quickAddTaskAction: vi.fn(), quickAddSnagAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("QuickAdd", () => {
  it("opens, lists enabled actions, and closes via button and Escape", () => {
    render(<QuickAdd />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /quick add/i }));
    const dialog = screen.getByRole("dialog", { name: "Quick Add" });
    for (const label of QUICK_ACTIONS) {
      const btn = within(dialog).getByRole("button", { name: label }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /quick add/i }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AppNav", () => {
  it("links built routes including More; Money is a link", () => {
    render(<AppNav variant="sidebar" />);
    expect(screen.getByRole("link", { name: /home/i }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /tasks/i }).getAttribute("href")).toBe("/tasks");
    expect(screen.getByRole("link", { name: /snags/i }).getAttribute("href")).toBe("/snags");
    expect(screen.getByRole("link", { name: /settings/i }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: /money/i }).getAttribute("href")).toBe("/money");
  });
});

describe("navigation and header", () => {
  it("keeps the bottom nav to five available items", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Home", "Tasks", "Snags", "Money", "Settings"]);
    expect(NAV_ITEMS.every((i) => i.available)).toBe(true);
  });
  it("bell links to notifications and shows a badge only when there are unread", () => {
    const { rerender } = render(<NotificationBell unread={3} />);
    expect(screen.getByRole("link", { name: "Notifications, 3 unread" }).getAttribute("href")).toBe("/notifications");
    expect(screen.getByTestId("notification-badge").textContent).toBe("3");
    rerender(<NotificationBell unread={0} />);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });
});

describe("service worker", () => {
  it("does not cache anything", () => {
    const src = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(src).not.toMatch(/caches\s*\.\s*(put|open|match)|cache\s*\.\s*(add|addAll|put)\b/);
    expect(src).not.toMatch(/['"]fetch['"]/);
  });
});
