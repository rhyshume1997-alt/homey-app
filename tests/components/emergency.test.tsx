// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { EmergencyCard } from "@/components/emergency/EmergencyCard";
import type { EmergencyActions } from "@/components/emergency/types";
import { phoneHref, type EmergencyItem } from "@/contracts/emergency";

afterEach(cleanup);

const noop = async () => null;
const actions: EmergencyActions = { add: noop, update: noop, remove: noop };

let n = 0;
const item = (o: Partial<EmergencyItem>): EmergencyItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "00000000-0000-4000-8000-000000000001",
  section: "location",
  label: "Stopcock",
  detail: "Not set yet",
  sort_order: 10,
  created_by: null,
  created_at: "2026-10-24T10:00:00Z",
  updated_at: "2026-10-24T10:00:00Z",
  ...o,
});

describe("phoneHref", () => {
  it("turns phone-like details into tel: links", () => {
    expect(phoneHref("0800 111 999")).toBe("tel:0800111999");
    expect(phoneHref("+44 (0)20 7946 0958")).toBe("tel:+4402079460958");
    expect(phoneHref("01632-960-001")).toBe("tel:01632960001");
  });

  it("leaves placeholders and free text alone", () => {
    expect(phoneHref("Not set yet")).toBeNull();
    expect(phoneHref("Understairs cupboard")).toBeNull();
    expect(phoneHref("123")).toBeNull();
    expect(phoneHref("Call 0800 111 999")).toBeNull();
  });
});

describe("EmergencyCard", () => {
  const items = [
    item({ id: "00000000-0000-4000-8000-000000000101", section: "location", label: "Stopcock", detail: "Under the stairs" }),
    item({ id: "00000000-0000-4000-8000-000000000102", section: "step", label: "Boiler reset", detail: "Hold reset 5 seconds", sort_order: 10 }),
    item({ id: "00000000-0000-4000-8000-000000000103", section: "number", label: "Gas emergency", detail: "0800 111 999", sort_order: 10 }),
    item({ id: "00000000-0000-4000-8000-000000000104", section: "number", label: "Water supplier", detail: "Not set yet", sort_order: 20 }),
  ];

  it("renders the three sections in order", () => {
    render(<EmergencyCard items={items} actions={actions} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Where things are", "Boiler and steps", "Numbers"]);
  });

  it("makes phone-like numbers tel: links and leaves placeholders as text", () => {
    render(<EmergencyCard items={items} actions={actions} />);
    const numbers = screen.getByRole("region", { name: "Numbers" });
    const link = within(numbers).getByRole("link", { name: "Call Gas emergency on 0800 111 999" });
    expect(link.getAttribute("href")).toBe("tel:0800111999");
    expect(within(numbers).queryAllByRole("link")).toHaveLength(1);
    expect(within(numbers).getByText("Not set yet", { selector: "p" })).toBeTruthy();
  });

  it("numbers the boiler steps in order", () => {
    render(
      <EmergencyCard
        items={[
          item({ section: "step", label: "Boiler reset", detail: "Check gauge", sort_order: 10 }),
          item({ section: "step", label: "Call engineer", detail: "Not set yet", sort_order: 20 }),
        ]}
        actions={actions}
      />,
    );
    const steps = screen.getByRole("region", { name: "Boiler and steps" });
    const list = within(steps).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getByText("1.")).toBeTruthy();
    expect(within(list).getByText("2.")).toBeTruthy();
  });

  it("shows an empty message for a section with no items", () => {
    render(<EmergencyCard items={[]} actions={actions} />);
    expect(screen.getAllByText("Nothing here yet.")).toHaveLength(3);
  });

  it("offers remove behind a confirm button that carries the item id", () => {
    render(<EmergencyCard items={[items[0]]} actions={actions} />);
    const confirm = screen.getByRole("button", { name: "Confirm remove Stopcock" });
    const form = confirm.closest("form") as HTMLFormElement;
    expect((form.querySelector('input[name="id"]') as HTMLInputElement).value).toBe(items[0].id);
  });
});
