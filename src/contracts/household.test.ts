import { describe, expect, it } from "vitest";
import { HouseholdMemberSchema, LogAuditInputSchema } from "./household";

const id = "11111111-1111-4111-8111-111111111111";

describe("household contracts", () => {
  it("accepts a valid LogAuditInput at the limits", () => {
    expect(
      LogAuditInputSchema.safeParse({ household: id, action: "a".repeat(64), entityType: "t", summary: "s".repeat(500) }).success,
    ).toBe(true);
  });
  it("rejects over-limit and empty fields", () => {
    expect(LogAuditInputSchema.safeParse({ household: id, action: "a".repeat(65), entityType: "t" }).success).toBe(false);
    expect(LogAuditInputSchema.safeParse({ household: id, action: "a", entityType: "t", summary: "s".repeat(501) }).success).toBe(false);
    expect(LogAuditInputSchema.safeParse({ household: id, action: "", entityType: "t" }).success).toBe(false);
  });
  it("restricts member role", () => {
    const base = { household_id: id, user_id: id, display_name: "A", created_at: "2026-01-01T00:00:00Z" };
    expect(HouseholdMemberSchema.safeParse({ ...base, role: "owner" }).success).toBe(true);
    expect(HouseholdMemberSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
  });
});
