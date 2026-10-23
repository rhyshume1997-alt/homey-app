// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseAppearance } from "@/components/appearance";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";

afterEach(cleanup);

describe("parseAppearance", () => {
  it("defaults to dark", () => {
    expect(parseAppearance(undefined)).toBe("dark");
    expect(parseAppearance(null)).toBe("dark");
    expect(parseAppearance({})).toBe("dark");
    expect(parseAppearance({ appearance: "neon" })).toBe("dark");
  });
  it("accepts the three valid values", () => {
    expect(parseAppearance({ appearance: "light" })).toBe("light");
    expect(parseAppearance({ appearance: "system" })).toBe("system");
    expect(parseAppearance({ appearance: "dark" })).toBe("dark");
  });
});

describe("AppearanceSettings", () => {
  it("offers Dark, Light and Match phone and preselects the saved choice", () => {
    render(<AppearanceSettings current="system" action={async () => null} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect((screen.getByLabelText("Match phone") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Dark") as HTMLInputElement).checked).toBe(false);
  });
});
