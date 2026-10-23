// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AREA_TINT, GlassIcon, ICONS, TINTS, type IconName } from "@/components/ui/GlassIcon";

const names = Object.keys(ICONS) as IconName[];
afterEach(cleanup);

describe("GlassIcon", () => {
  it("covers the full set", () => {
    for (const n of ["sparkle", "cart", "bolt", "wrench", "mail", "gear", "shield", "wifi", "room", "gift", "star", "checklist",
      "appliance", "meter", "meal", "plus", "chevron-right", "close", "search", "house-heart", "people", "phone", "key", "drop", "flame"]) {
      expect(names).toContain(n);
    }
  });

  it.each(names)("renders %s decorative by default", (name) => {
    const { container } = render(<GlassIcon name={name} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.getAttribute("role")).toBeNull();
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it.each(names)("labels %s when a label is given", (name) => {
    const { getByRole } = render(<GlassIcon name={name} label="Thing" />);
    expect(getByRole("img", { name: "Thing" })).toBeTruthy();
  });

  it("maps areas to known tints", () => {
    for (const t of Object.values(AREA_TINT)) expect(TINTS[t]).toBeTruthy();
    expect(AREA_TINT.snags).toBe("rose");
    expect(AREA_TINT.money).toBe("amber");
  });
});
