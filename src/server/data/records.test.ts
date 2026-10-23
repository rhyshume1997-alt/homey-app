import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/supabase", () => ({ createUserClient: vi.fn() }));

import { parseAmount } from "./records";

describe("parseAmount", () => {
  it("accepts plain, pound-prefixed and comma-grouped amounts", () => {
    expect(parseAmount("42.17")).toBe(42.17);
    expect(parseAmount(" £1,234.5 ")).toBe(1234.5);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("2900")).toBe(2900);
  });

  it("rejects anything that is not a non-negative amount with up to 2 decimals", () => {
    for (const bad of ["", "-5", "1.234", "abc", "1e3", "£", "12.", ".5", "1 000", "9999999999999"]) {
      expect(parseAmount(bad)).toBeNull();
    }
    expect(parseAmount(null)).toBeNull();
  });
});
