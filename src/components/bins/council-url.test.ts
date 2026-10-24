import { describe, expect, it } from "vitest";
import { parseCouncilUrl } from "./council-url";

describe("parseCouncilUrl", () => {
  it("accepts https links and trims", () => {
    expect(parseCouncilUrl("  https://www.example.gov.uk/bins?postcode=AB1  ")).toBe("https://www.example.gov.uk/bins?postcode=AB1");
  });
  it.each([
    "http://example.gov.uk/bins", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "//example.com",
    "https://user:pw@example.gov.uk/", "https://user@example.gov.uk/", "example.gov.uk", "https://", "", "https://a.b/ x",
    `https://example.gov.uk/${"a".repeat(500)}`,
  ])("rejects %s", (v) => expect(parseCouncilUrl(v)).toBeNull());
  it("rejects non-strings", () => expect(parseCouncilUrl(null)).toBeNull());
});
