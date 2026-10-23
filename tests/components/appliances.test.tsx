// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ApplianceList } from "@/components/appliances/ApplianceList";
import { ApplianceDetail } from "@/components/appliances/ApplianceDetail";
import { RoomAppliances } from "@/components/appliances/RoomAppliances";
import { ServiceTaskButton } from "@/components/appliances/ServiceTaskButton";
import { ApplianceDraftSchema, ApplianceInputSchema, type Appliance } from "@/contracts/appliances";
import { DEFAULT_DATE_PREFS } from "@/components/dates";

afterEach(cleanup);

const TODAY = "2026-10-22";
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const appliance = (o: Partial<Appliance> = {}): Appliance => ({
  id: uid(), household_id: uid(), room_id: null, name: "Dishwasher", make: null, model: null, serial_last4: null,
  purchase_date: null, warranty_end: null, source: "manual", manual_document_id: null, receipt_document_id: null,
  notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...o,
});

describe("ApplianceList", () => {
  it("shows an empty state", () => {
    render(<ApplianceList appliances={[]} rooms={{}} today={TODAY} prefs={DEFAULT_DATE_PREFS} />);
    expect(screen.getByText(/No appliances yet/)).toBeTruthy();
  });

  it("pairs a traffic-light pill with each warranty, most urgent first, and shows the room", () => {
    const room = uid();
    const list = [
      appliance({ name: "Oven", warranty_end: "2027-12-01" }),
      appliance({ name: "Fridge", warranty_end: "2026-10-01", room_id: room }),
      appliance({ name: "Kettle", warranty_end: "2026-11-10" }),
      appliance({ name: "Mixer" }),
    ];
    render(<ApplianceList appliances={list} rooms={{ [room]: "Kitchen" }} today={TODAY} prefs={DEFAULT_DATE_PREFS} />);
    const rows = screen.getAllByTestId("appliance-row");
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Fridge", "Kettle", "Oven", "Mixer"]);
    expect(rows[0].querySelector("[data-light]")?.getAttribute("data-light")).toBe("red");
    expect(rows[0].textContent).toContain("Expired");
    expect(rows[0].textContent).toContain("Kitchen");
    expect(rows[1].querySelector("[data-light]")?.getAttribute("data-light")).toBe("amber");
    expect(rows[2].querySelector("[data-light]")?.getAttribute("data-light")).toBe("green");
    expect(rows[3].querySelector("[data-light]")).toBeNull();
  });
});

describe("ApplianceDetail", () => {
  it("links documents through the authorised open route, never a raw URL", () => {
    const m = uid();
    const r = uid();
    render(
      <ApplianceDetail
        appliance={appliance({ manual_document_id: m, receipt_document_id: r, serial_last4: "9F2K" })}
        manualTitle="Manual" receiptTitle="Receipt" today={TODAY} prefs={DEFAULT_DATE_PREFS}
      />,
    );
    expect(screen.getByRole("link", { name: "Manual: Manual" }).getAttribute("href")).toBe(`/documents/${m}/open`);
    expect(screen.getByRole("link", { name: "Receipt: Receipt" }).getAttribute("href")).toBe(`/documents/${r}/open`);
    expect(screen.getByText("9F2K")).toBeTruthy();
  });

  it("says when no documents are linked", () => {
    render(<ApplianceDetail appliance={appliance()} today={TODAY} prefs={DEFAULT_DATE_PREFS} />);
    expect(screen.getByText("No documents linked.")).toBeTruthy();
  });
});

describe("RoomAppliances", () => {
  it("renders an empty state and a list", () => {
    render(<RoomAppliances appliances={[]} today={TODAY} prefs={DEFAULT_DATE_PREFS} />);
    expect(screen.getByText("No appliances in this room.")).toBeTruthy();
    cleanup();
    render(<RoomAppliances appliances={[appliance({ name: "Hob" })]} today={TODAY} prefs={DEFAULT_DATE_PREFS} />);
    expect(screen.getByRole("link", { name: "Hob" })).toBeTruthy();
  });
});

describe("ServiceTaskButton", () => {
  it("creates nothing until the person confirms", () => {
    let calls = 0;
    const action = async () => {
      calls++;
      return { ok: true };
    };
    render(<ServiceTaskButton action={action} applianceId={uid()} applianceName="Boiler" />);
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Service task" }));
    expect(screen.getByText(/Service: Boiler/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy();
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "+ Service task" })).toBeTruthy();
    expect(calls).toBe(0);
  });
});

describe("input validation", () => {
  it("accepts last 4 only and turns blanks into null", () => {
    const ok = ApplianceInputSchema.safeParse({ name: "Oven", serial_last4: "ab12", make: "", warranty_end: "" });
    expect(ok.success && ok.data.make).toBeNull();
    expect(ok.success && ok.data.warranty_end).toBeNull();
    expect(ApplianceInputSchema.safeParse({ name: "Oven", serial_last4: "ABC123456" }).success).toBe(false);
    expect(ApplianceInputSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(ApplianceInputSchema.safeParse({ name: "Oven", notes: "n".repeat(501) }).success).toBe(false);
  });

  it("requires a message hash on email drafts", () => {
    expect(ApplianceDraftSchema.safeParse({ name: "Oven" }).success).toBe(false);
    expect(ApplianceDraftSchema.safeParse({ name: "Oven", source_message_hash: "a".repeat(64) }).success).toBe(true);
  });
});
