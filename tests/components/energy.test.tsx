// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EnergySections } from "@/components/energy/EnergySections";
import { ReadingsSection } from "@/components/energy/ReadingsSection";
import { computeUsage } from "@/components/energy/usage";
import type { MeterReading } from "@/contracts/meter-readings";
import { EnergyCard } from "@/components/home/EnergyCard";
import { groupEnergy } from "@/components/energy/group";
import type { HouseholdRecord } from "@/contracts/records";

afterEach(cleanup);
let n = 0;
const rec = (o: Partial<HouseholdRecord>): HouseholdRecord => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "00000000-0000-4000-8000-0000000000aa",
  category: "electricity", provider: null, title: "Item", amount: null, unit: null, amount_kind: null,
  frequency: null, start_date: null, renewal_date: null, end_date: null, next_action: null,
  reference_last4: null, status: null, source: null, verified: false, as_of: null, import_key: null,
  created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...o,
});
const today = "2026-10-21";
const records = [
  rec({ provider: "Octo", title: "Fixed 24.5p/kWh, 60p/day", end_date: "2026-12-01", source: "master record" }),
  rec({ title: "Oct bill", amount: 82.4, unit: "GBP", amount_kind: "bill", start_date: "2026-09-01", end_date: "2026-09-30", source: "bill pdf" }),
  rec({ title: "Annual use", amount: 2900, unit: "kWh", amount_kind: "estimate", source: "EPC" }),
  rec({ title: "Billed use", amount: 210, unit: "kWh", amount_kind: "bill", verified: true, source: "bill" }),
  rec({ title: "Assessed use", amount: 3100, unit: "kWh", amount_kind: "snapshot", source: "survey" }),
  rec({ category: "solar", title: "4kW array", amount: 3500, unit: "kWh", amount_kind: "estimate", status: "Not registered for export", next_action: "Register SEG", source: "installer" }),
  rec({ category: "energy_efficiency", title: "Loft insulation", next_action: "Get quote" }),
];

describe("EnergySections", () => {
  it("labels estimates, bills and assessments and never mixes kWh with pounds", () => {
    render(<EnergySections data={groupEnergy(records)} today={today} />);
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    expect(screen.getByText("From a bill")).toBeTruthy();
    expect(screen.getByText("From an assessment")).toBeTruthy();
    expect(screen.getByText(/Estimated annual generation 3,500 kWh \(estimate\)/)).toBeTruthy();
    expect(screen.getByText("£82.40")).toBeTruthy();
    expect(screen.queryByText(/£2,900|£3,500|£210/)).toBeNull();
    expect(screen.queryByText(/82\.4 kWh/)).toBeNull();
    const row = screen.getByTestId("bill-row");
    expect(row.textContent).toContain("Bill");
    expect(row.textContent).toContain("01/Sep/2026 to 30/Sep/2026");
  });

  it("shows tariff countdown, source and Unverified only where not verified", () => {
    render(<EnergySections data={groupEnergy(records)} today={today} />);
    expect(screen.getByText(/Fixed deal ends 01\/Dec\/2026, 41 days/)).toBeTruthy();
    expect(screen.getByText(/Source: master record/)).toBeTruthy();
    expect(screen.getAllByText("Unverified")).toHaveLength(6);
  });

  it("invents no derived numbers", () => {
    render(<EnergySections data={groupEnergy(records)} today={today} />);
    expect(screen.queryByText(/average|per day|total|saving/i)).toBeNull();
  });

  it("shows the empty state", () => {
    render(<EnergySections data={groupEnergy([])} today={today} />);
    expect(screen.getByText("No energy figures imported yet.")).toBeTruthy();
  });
});

describe("EnergyCard", () => {
  it("shows countdown, latest bill and solar status as recorded", () => {
    render(<EnergyCard data={groupEnergy(records)} today={today} />);
    const t = screen.getByTestId("energy-card").textContent!;
    expect(t).toContain("Tariff ends 01/Dec/2026");
    expect(t).toContain("in 41 days");
    expect(t).toContain("£82.40");
    expect(t).toContain("Not registered for export");
  });
  it("empty state", () => {
    render(<EnergyCard data={groupEnergy([])} today={today} />);
    expect(screen.getByText("No energy figures yet")).toBeTruthy();
  });
});

const mr = (o: Partial<MeterReading>): MeterReading => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  fuel: "electricity", read_on: "2026-09-01", value: 1000, unit: "kWh", source: "manual", note: null, ...o,
});
const noop = async () => null;
const actions = { add: noop, remove: noop };
const view = (readings: MeterReading[] | null) =>
  render(<ReadingsSection readings={readings} today={today} actions={actions} />);

describe("ReadingsSection", () => {
  it("asks for two readings when there are fewer", () => {
    view([mr({})]);
    expect(screen.getByText("Add at least two readings to see usage")).toBeTruthy();
    expect(screen.queryByTestId("usage-bar")).toBeNull();
  });

  it("shows the empty state and the entry form", () => {
    view([]);
    expect(screen.getByText("No readings yet.")).toBeTruthy();
    expect(screen.getByLabelText("Fuel")).toBeTruthy();
    expect(screen.getByLabelText("Date read")).toBeTruthy();
    expect(screen.getByLabelText("Reading")).toBeTruthy();
    expect(screen.getByLabelText("Unit")).toBeTruthy();
  });

  it("computes usage only from consecutive readings, per day", () => {
    view([
      mr({ read_on: "2026-09-01", value: 1000 }),
      mr({ read_on: "2026-09-11", value: 1100 }),
      mr({ read_on: "2026-10-01", value: 1400 }),
    ]);
    expect(screen.getAllByTestId("usage-bar")).toHaveLength(2);
    const rows = screen.getAllByTestId("usage-row").map((r) => r.textContent);
    expect(rows[0]).toContain("300 kWh");
    expect(rows[0]).toContain("15 kWh/day");
    expect(rows[1]).toContain("100 kWh");
    expect(rows[1]).toContain("10 kWh/day");
    expect(screen.getByText(/Nothing is\s+estimated/)).toBeTruthy();
  });

  it("does not use a lower later reading and says so", () => {
    view([mr({ read_on: "2026-09-01", value: 5000 }), mr({ read_on: "2026-09-10", value: 10 })]);
    expect(screen.getByText("Add at least two readings to see usage")).toBeTruthy();
    expect(screen.getByText(/left out because/)).toBeTruthy();
  });

  it("keeps fuels apart", () => {
    const u = computeUsage(
      [mr({ read_on: "2026-09-01", value: 10 }), mr({ fuel: "gas", unit: "m3", read_on: "2026-09-05", value: 99 }), mr({ read_on: "2026-09-03", value: 14 })],
      "electricity",
    );
    expect(u.periods).toHaveLength(1);
    expect(u.periods[0].perDay).toBe(2);
  });

  it("shows a load failure", () => {
    view(null);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
