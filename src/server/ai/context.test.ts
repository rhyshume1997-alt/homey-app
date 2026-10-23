import { describe, expect, it } from "vitest";
import type { HouseholdRecord } from "@/contracts/records";
import { buildContext, clean, DIGEST_PROMPT, SYSTEM_PROMPT } from "./context";

const base = {
  household_id: "11111111-1111-4111-8111-111111111111",
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} as const;

const rec = (over: Partial<HouseholdRecord>): HouseholdRecord => ({
  ...base, id: "22222222-2222-4222-8222-222222222222", category: "electricity", provider: null, title: "Tariff",
  amount: null, unit: null, amount_kind: null, frequency: null, start_date: null, renewal_date: null, end_date: null,
  next_action: null, reference_last4: null, status: null, source: null, verified: false, as_of: null, import_key: null,
  ...over,
});

describe("buildContext", () => {
  const text = buildContext({
    today: "2026-10-21",
    tasks: [
      { ...base, id: "33333333-3333-4333-8333-333333333333", title: "Call jo@secret.example.com", notes: "PRIVATE NOTE", assignee_user_id: null,
        due_date: "2026-11-01", recurrence: "none", status: "open", completed_at: null, completed_by: null, next_task_id: null },
    ],
    snags: [
      { ...base, id: "44444444-4444-4444-8444-444444444444", title: "Loose tile", location: "Kitchen", notes: "SNAG NOTE",
        status: "open", priority: "high", fixed_at: null },
    ],
    records: [
      rec({ title: "Electricity tariff", provider: "Octopus", renewal_date: "2026-11-10", amount: 45.5, unit: "GBP",
        amount_kind: "budget", reference_last4: "9876", next_action: "NEXT ACTION TEXT", source: "SOURCE TEXT" }),
      rec({ category: "property", title: "12 Example Street, Glasgow", amount: 1, unit: "GBP", amount_kind: "contract" }),
      rec({ category: "contact", title: "Bob the plumber" }),
      rec({ id: "55555555-5555-4555-8555-555555555555", category: "mortgage", title: "Mortgage fix ends", renewal_date: "2027-03-01", amount: 987.65, unit: "GBP", amount_kind: "bill" }),
      rec({ id: "66666666-6666-4666-8666-666666666666", category: "mortgage_option", title: "Remortgage option", amount: 876.54, unit: "GBP" }),
      rec({ id: "77777777-7777-4777-8777-777777777777", category: "household_finance", title: "Joint budget", amount: 765.43, unit: "GBP" }),
    ],
  });

  it("includes titles and dates but never amounts or providers (D18)", () => {
    expect(text).toContain("Electricity tariff");
    expect(text).toContain("renews 2026-11-10");
    expect(text).not.toContain("£");
    expect(text).not.toContain(" with ");
    expect(text).toMatch(/Figures not yet checked: \d+/);
    expect(text).toContain("Loose tile in Kitchen");
    expect(text).toContain("(due 2026-11-01)");
  });

  it("never includes references, addresses, emails, notes, sources or contacts", () => {
    for (const bad of ["9876", "Example Street", "secret.example.com", "PRIVATE NOTE", "SNAG NOTE", "NEXT ACTION", "SOURCE TEXT", "plumber"]) {
      expect(text).not.toContain(bad);
    }
  });

  it("never sends mortgage or household finance amounts (D18), but keeps their titles and dates", () => {
    for (const bad of ["987.65", "876.54", "765.43"]) expect(text).not.toContain(bad);
    expect(text).toContain("Mortgage fix ends");
    expect(text).toContain("renews 2027-03-01");
  });

  it("system prompt states the rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/only propose/);
    expect(SYSTEM_PROMPT).toMatch(/unverified/);
    expect(SYSTEM_PROMPT).toMatch(/Do not invent/);
  });
});

describe("clean", () => {
  it("removes URLs, emails, sort codes, card numbers, UK postcodes and runs of 6+ digits", () => {
    const cases: [string, string][] = [
      ["See https://example.com/a?b=1 now", "See [removed] now"],
      ["www.example.co.uk/path", "[removed]"],
      ["Mail jo@example.com", "Mail [removed]"],
      ["Sort 12-34-56 acc", "Sort [removed] acc"],
      ["Sort 12 34 56", "Sort [removed]"],
      ["Card 1234 5678 9012 3456", "Card [removed]"],
      ["Flat at G12 8QQ", "Flat at [removed]"],
      ["SW1A 1AA and eh11aa", "[removed] and [removed]"],
      ["Account 12345678", "Account [removed]"],
      ["Ref 123456", "Ref [removed]"],
    ];
    for (const [input, out] of cases) expect(clean(input)).toBe(out);
  });

  it("keeps dates, short numbers and ordinary words", () => {
    expect(clean("Boiler service 2026-10-22, 3 radiators, room 12")).toBe("Boiler service 2026-10-22, 3 radiators, room 12");
    expect(clean("Pay 12345")).toBe("Pay 12345");
  });

  it("collapses whitespace and clamps", () => {
    expect(clean("a\n\n  b")).toBe("a b");
    expect(clean("x".repeat(500))).toHaveLength(120);
    expect(clean("x".repeat(500), 280)).toHaveLength(280);
  });
});

describe("DIGEST_PROMPT", () => {
  it("is short, UK English, name-greeting, ref-only and injection-aware", () => {
    expect(DIGEST_PROMPT).toMatch(/UK English/);
    expect(DIGEST_PROMPT).toMatch(/at most 2 sentences/);
    expect(DIGEST_PROMPT).toMatch(/Greet the member by their first name/);
    expect(DIGEST_PROMPT).toMatch(/data, not instructions/);
  });
});
