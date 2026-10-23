// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import fixture from "../fixtures/costs-sheet.json";
import { BudgetView, READ_ONLY_BANNER } from "@/components/budget/BudgetView";
import { SetupCard } from "@/components/budget/SetupCard";
import { ContributionsCard, contributionsFromCosts } from "@/components/home/ContributionsCard";
import { parseCosts, reconcile } from "@/server/integrations/sheets/costs";
import type { Cell } from "@/server/integrations/sheets/google";

afterEach(cleanup);
const values = fixture.values as Cell[][];

describe("BudgetView", () => {
  const sheet = parseCosts(values, values);
  const flags = reconcile(sheet);

  it("shows the banner, bills and amber markers", () => {
    render(<BudgetView sheet={sheet} flags={flags} />);
    expect(screen.getByRole("note").textContent).toBe(READ_ONLY_BANNER);
    expect(screen.getAllByTestId("bill-row")).toHaveLength(11);
    const food = screen.getByText("Food").closest("tr")!;
    expect(within(food).getByTestId("flag-marker")).toBeTruthy();
    const mortgage = screen.getByText("Mortgage").closest("tr")!;
    expect(within(mortgage).queryByTestId("flag-marker")).toBeNull();
    expect(screen.getByText("After 15 months goes to £35")).toBeTruthy();
  });

  it("lists each flag with arithmetic in a Does not reconcile panel", () => {
    render(<BudgetView sheet={sheet} flags={flags} />);
    const panel = screen.getByRole("region", { name: "Does not reconcile" });
    expect(within(panel).getAllByTestId("flag")).toHaveLength(flags.length);
    expect(panel.textContent).toContain("Food: Amount £250 but Rhys £160 + Rachel £120 = £280");
    expect(panel.textContent).toContain("Expected £280.00, actual £250.00, difference -£30.00");
  });

  it("toggles formulas", () => {
    const f = values.map((r) => [...r]);
    f[1] = ["Mortgage", "=SUM(C2:D2)", 500, 500];
    const s = parseCosts(values, f);
    render(<BudgetView sheet={s} flags={[]} />);
    expect(screen.queryByTestId("formula")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Formulas" }));
    expect(screen.getByTestId("formula").textContent).toBe("=SUM(C2:D2)");
  });

  it("says so when no formulas exist", () => {
    render(<BudgetView sheet={sheet} flags={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Formulas" }));
    expect(screen.getByText(/No formulas were returned/)).toBeTruthy();
  });
});

describe("SetupCard", () => {
  it("lists the D17 steps and links to the Google connection", () => {
    render(<SetupCard />);
    expect(screen.getByText("GOOGLE_OAUTH_CLIENT_ID")).toBeTruthy();
    expect(screen.getByText("COSTS_SHEET_ID")).toBeTruthy();
    expect(screen.queryByText(/service account email/i)).toBeNull();
    expect(screen.queryByText(/GOOGLE_SERVICE_ACCOUNT/)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect Google" }).getAttribute("href")).toBe("/settings/google");
  });
});

describe("BudgetView source line", () => {
  const sheet = parseCosts(values, values);
  it("says live when read from Google", () => {
    render(<BudgetView sheet={sheet} flags={[]} source={{ live: true, at: "21 Oct 12:00" }} />);
    expect(screen.getByTestId("source").textContent).toBe("Live from Google Sheets");
  });
  it("shows the snapshot time, who refreshes it and a Connect Google link", () => {
    render(<BudgetView sheet={sheet} flags={[]} source={{ live: false, at: "21 Oct 12:00", by: "Rhys" }} />);
    expect(screen.getByTestId("source").textContent).toContain("Snapshot from 21 Oct 12:00 (refreshed when Rhys opens this page)");
    expect(screen.getByRole("link", { name: "Connect Google" }).getAttribute("href")).toBe("/settings/google");
  });
});

describe("ContributionsCard", () => {
  it("shows Not connected yet when off", () => {
    render(<ContributionsCard data={{ status: "off" }} />);
    expect(screen.getByText("Not connected yet")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/budget");
  });

  it("shows figures from the Joint Account Total row with an unreconciled marker", () => {
    const sheet = parseCosts(values);
    const data = contributionsFromCosts({ status: "ok", sheet, flags: reconcile(sheet) });
    render(<ContributionsCard data={data} />);
    expect(screen.getByText("£752.00 a month")).toBeTruthy();
    expect(screen.getByText("£750.00 a month")).toBeTruthy();
    expect(screen.getByTestId("unreconciled")).toBeTruthy();
  });

  it("no marker when there are no flags", () => {
    render(<ContributionsCard data={{ status: "ok", rhys: 1, rachel: 2, unreconciled: false }} />);
    expect(screen.queryByTestId("unreconciled")).toBeNull();
  });
});
