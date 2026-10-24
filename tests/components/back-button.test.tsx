// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let pathname = "/";
const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ back, push }) }));

import { BackButton, parentPath } from "@/components/BackButton";

beforeEach(() => {
  window.sessionStorage.clear();
  back.mockClear();
  push.mockClear();
});
afterEach(cleanup);

describe("BackButton", () => {
  it("renders nothing on Home", () => {
    pathname = "/";
    render(<BackButton />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("is visible elsewhere with the name Back", () => {
    pathname = "/tasks";
    render(<BackButton />);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("goes back when there is an in-app previous path", () => {
    pathname = "/";
    const { rerender } = render(<BackButton />);
    pathname = "/tasks";
    rerender(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes the parent path when there is no history", () => {
    pathname = "/money/check";
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(push).toHaveBeenCalledWith("/money");
    expect(back).not.toHaveBeenCalled();
  });
});

describe("parentPath", () => {
  it.each([
    ["/", "/"],
    ["/a", "/"],
    ["/a/b", "/a"],
    ["/a/b/", "/a"],
    ["/settings/google", "/settings"],
    ["//evil.com", "/"],
    ["//evil.com/x", "/"],
    ["https://evil.com/x", "/"],
    ["/\\evil.com", "/"],
  ])("%s -> %s", (input, out) => {
    expect(parentPath(input)).toBe(out);
  });
});
