// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MembersList, type MemberView } from "@/components/more/MembersList";
import { MORE_GROUPS, MoreHub } from "@/components/more/MoreHub";

afterEach(cleanup);

const members: MemberView[] = [
  { displayName: "Sam", role: "member" },
  { displayName: "Alex", role: "owner" },
];

describe("MembersList", () => {
  it("lists display name and role for each member", () => {
    render(<MembersList members={members} />);
    const list = screen.getByRole("list", { name: "Household members" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("SamMember");
    expect(items[1]!.textContent).toBe("AlexOwner");
  });

  it("shows an empty state when there are no members", () => {
    render(<MembersList members={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No household members found.")).toBeTruthy();
  });

  it("shows an error message instead of the list when loading failed", () => {
    render(<MembersList members={[]} error />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/Could not load household members/)).toBeTruthy();
  });

  it("never renders email addresses or user ids", () => {
    const { container } = render(<MembersList members={members} />);
    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("MoreHub", () => {
  const expected: Record<string, string> = {
    Rooms: "/rooms",
    "Things to get": "/things-to-get",
    "Seasonal checklist": "/checklist",
    Calendar: "/calendar",
    Shopping: "/shopping",
    Meals: "/meals",
    Bins: "/bins",
    Maintenance: "/maintenance",
    Appliances: "/appliances",
    "Costs sheet": "/budget",
    "Check figures": "/money/check",
    House: "/house",
    Mortgage: "/mortgage",
    Contacts: "/contacts",
    Energy: "/energy",
    Documents: "/documents",
    "Emergency card": "/emergency",
    "Guest wifi": "/wifi",
    "Awaiting replies": "/replies",
    Notifications: "/notifications",
    "Homey chat": "/assistant",
  };

  it("links every hub destination to the expected route", () => {
    render(<MoreHub />);
    for (const [label, href] of Object.entries(expected)) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("renders exactly the expected tiles and no others", () => {
    const { container } = render(<MoreHub />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(Object.keys(expected).length);
    expect(links.map((a) => a.getAttribute("href")).sort()).toEqual(Object.values(expected).sort());
  });

  it("groups tiles under the agreed headings", () => {
    render(<MoreHub />);
    const titles = ["Household", "Money and home", "Safety and guests", "Inbox", "Homey"];
    for (const title of titles) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    }
    expect(MORE_GROUPS.map((g) => g.title)).toEqual(titles);
  });

  it("renders icons decoratively so each tile's accessible name is its label", () => {
    const { container } = render(<MoreHub />);
    const icons = container.querySelectorAll(".glass-icon");
    expect(icons).toHaveLength(Object.keys(expected).length);
    icons.forEach((icon) => expect(icon.getAttribute("aria-hidden")).toBe("true"));
  });

  it("keeps every tile at least 88px tall", () => {
    const { container } = render(<MoreHub />);
    const links = Array.from(container.querySelectorAll("a"));
    links.forEach((a) => expect(a.className).toContain("min-h-[88px]"));
  });
});
