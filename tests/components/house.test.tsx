// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MortgageView } from "@/components/house/MortgageView";
import { HouseView } from "@/components/house/HouseView";
import { ContactsView } from "@/components/house/ContactsView";
import { deriveProviders } from "@/components/house/model";
import type { HouseholdRecord } from "@/contracts/records";

afterEach(cleanup);
const action = vi.fn(async () => null);
let n = 0;
const rec = (o: Partial<HouseholdRecord>): HouseholdRecord => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "00000000-0000-4000-8000-0000000000aa",
  category: "mortgage", provider: null, title: "Item", amount: null, unit: null, amount_kind: null,
  frequency: null, start_date: null, renewal_date: null, end_date: null, next_action: null,
  reference_last4: null, status: null, source: null, verified: false, as_of: null, import_key: null,
  created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...o,
});

describe("MortgageView", () => {
  const rows = [
    rec({ title: "Principal", amount: 200000, unit: "GBP", amount_kind: "contract", end_date: "2027-01-01" }),
    rec({ title: "Monthly payment", amount: 1000, unit: "GBP", amount_kind: "budget", frequency: "monthly" }),
    rec({ title: "Balance", amount: 150000, unit: "GBP", amount_kind: "snapshot", as_of: "2026-03-05", reference_last4: "1234" }),
    rec({ title: "Undated balance", amount: 1, unit: "GBP", amount_kind: "snapshot" }),
    rec({ category: "mortgage_option", title: "Option A", amount: 900, unit: "GBP", amount_kind: "proposal" }),
    rec({ category: "banking", title: "Current account" }),
  ];
  it("labels snapshots, shows as-of, masks refs, shows countdown, no projections", () => {
    render(<MortgageView records={rows} today="2026-10-21" verifyAction={action} />);
    expect(screen.getAllByText(/Historic snapshot, not the live balance/)).toHaveLength(2);
    expect(screen.getByText("As of 05/Mar/2026")).toBeTruthy();
    expect(screen.getByText("As of: Unknown")).toBeTruthy();
    expect(screen.getByText("ref ••1234")).toBeTruthy();
    expect(screen.getByTestId("fixed-end").textContent).toContain("in 72 days");
    for (const h of ["Terms", "Payments", "Balance snapshots", "Options being considered", "Account notes"])
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/projected|remaining balance|payoff|calculator/i);
  }, 30000);
  it("shows Unknown for missing fixed-rate end and null fields", () => {
    render(<MortgageView records={[rec({ title: "Plain" })]} today="2026-10-21" verifyAction={action} />);
    expect(screen.getByText("Fixed-rate end date: Unknown")).toBeTruthy();
    expect(screen.getByText("Provider: Unknown")).toBeTruthy();
    expect(screen.getByText("Status: Unknown")).toBeTruthy();
  });
});

describe("HouseView", () => {
  it("shows purchase price with kind, EPC status and documents link", () => {
    render(
      <HouseView
        verifyAction={action}
        records={[
          rec({ category: "purchase", title: "Purchase price", amount: 250000, unit: "GBP", amount_kind: "contract" }),
          rec({ category: "property", title: "EPC rating C", status: "predicted" }),
        ]}
      />,
    );
    expect(screen.getByText("£250,000.00")).toBeTruthy();
    expect(screen.getByText("(contract)")).toBeTruthy();
    expect(screen.getByText("Status: predicted")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open documents" }).getAttribute("href")).toBe("/documents");
  });
});

describe("Contacts", () => {
  it("groups providers excluding unknown", () => {
    const g = deriveProviders([
      rec({ category: "gas", provider: "Acme" }),
      rec({ category: "electricity", provider: "acme" }),
      rec({ category: "water", provider: "Unknown" }),
      rec({ category: "broadband", provider: null }),
    ]);
    expect(g).toEqual([{ provider: "Acme", categories: ["electricity", "gas"], count: 2 }]);
  });
  it("renders contacts with Unknown since date", () => {
    render(
      <ContactsView
        data={{
          contacts: [rec({ category: "contact", provider: "Bob", title: "Plumber" })],
          providers: [{ provider: "Acme", categories: ["gas"], count: 1 }],
        }}
      />,
    );
    expect(screen.getByText("Since Unknown")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText(/Gas · 1 record$/)).toBeTruthy();
  });
});
