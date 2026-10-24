// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseShowSnags } from "@/components/snags/prefs";
import { AppNav } from "@/components/AppNav";
import { SnagsSetting } from "@/components/settings/SnagsSetting";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("parseShowSnags", () => {
  it("shows snags unless the person explicitly hid them", () => {
    expect(parseShowSnags(undefined)).toBe(true);
    expect(parseShowSnags(null)).toBe(true);
    expect(parseShowSnags({})).toBe(true);
    expect(parseShowSnags({ snags_hidden: "true" })).toBe(true);
    expect(parseShowSnags({ snags_hidden: 1 })).toBe(true);
    expect(parseShowSnags({ snags_hidden: false })).toBe(true);
    expect(parseShowSnags({ snags_hidden: true })).toBe(false);
  });
});

describe("AppNav with snags hidden", () => {
  it("leaves out the Snags tab and keeps the others", () => {
    render(<AppNav variant="tabs" hide={["/snags"]} />);
    expect(screen.queryByRole("link", { name: /snags/i })).toBeNull();
    for (const name of [/home/i, /chores/i, /money/i, /settings/i]) expect(screen.getByRole("link", { name })).toBeTruthy();
  });

  it("shows Snags by default", () => {
    render(<AppNav variant="tabs" />);
    expect(screen.getByRole("link", { name: /snags/i }).getAttribute("href")).toBe("/snags");
  });
});

describe("SnagsSetting", () => {
  it("offers to hide when shown, and to show when hidden", () => {
    const action = vi.fn();
    const { container, rerender } = render(<SnagsSetting shown action={action} />);
    expect(screen.getByRole("button", { name: "Hide the snag list" })).toBeTruthy();
    expect((container.querySelector('input[name="snags"]') as HTMLInputElement).value).toBe("hide");
    rerender(<SnagsSetting shown={false} action={action} />);
    expect(screen.getByRole("button", { name: "Show the snag list" })).toBeTruthy();
    expect((container.querySelector('input[name="snags"]') as HTMLInputElement).value).toBe("show");
    expect(screen.getByText(/Your snags are kept/)).toBeTruthy();
  });
});
