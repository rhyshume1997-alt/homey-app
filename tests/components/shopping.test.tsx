// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ShoppingSection } from "@/components/shopping/ShoppingSection";
import { SuppliesSection } from "@/components/shopping/SuppliesSection";
import { SuppliesCard } from "@/components/home/SuppliesCard";
import { sortSupplies, type ShoppingActions, type Supply, type SupplyActions } from "@/components/shopping/types";

afterEach(cleanup);

const noop = async () => null;
const shopActions: ShoppingActions = { add: noop, toggle: noop, remove: noop, clearBought: noop };
const supActions: SupplyActions = { add: noop, setStatus: noop, remove: noop, addLowToShopping: noop };

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const item = (o: Partial<Parameters<typeof ShoppingSection>[0]["items"][number]> = {}) => ({
  id: uid(), title: "Milk", quantity: null, shop: null, done: false, done_at: null, ...o,
});
const supply = (o: Partial<Supply> = {}): Supply => ({
  id: uid(), name: "Salt", location: null, status: "ok", notes: null, last_checked_at: null, ...o,
});

describe("ShoppingSection", () => {
  it("shows empty state with an add form", () => {
    render(<ShoppingSection items={[]} actions={shopActions} />);
    expect(screen.getByText("Nothing on the list yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to list" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear bought" })).toBeNull();
  });

  it("lists open items, bought items and a Clear bought button", () => {
    render(
      <ShoppingSection
        actions={shopActions}
        items={[
          item({ title: "Eggs", quantity: "12", shop: "Tesco" }),
          item({ title: "Bread", done: true, done_at: "2026-10-20T10:00:00Z" }),
        ]}
      />,
    );
    expect(screen.getByText("12 · Tesco")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark bought: Eggs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo bought: Bread" })).toBeTruthy();
    expect(screen.getByText("Bought 20/Oct/2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear bought" })).toBeTruthy();
  });

  it("sends done=true when ticking an open item", () => {
    render(<ShoppingSection actions={shopActions} items={[item({ title: "Eggs" })]} />);
    const row = screen.getByTestId("shopping-row");
    const hidden = row.querySelector('input[name="done"]') as HTMLInputElement;
    expect(hidden.value).toBe("true");
  });
});

describe("SuppliesSection", () => {
  it("sorts out first, then low, then ok", () => {
    expect(sortSupplies([supply({ name: "B" }), supply({ name: "A", status: "low" }), supply({ name: "C", status: "out" })]).map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  it("shows three status buttons per supply, marking the current one", () => {
    render(<SuppliesSection actions={supActions} supplies={[supply({ name: "Salt", status: "low" })]} />);
    const group = screen.getByRole("group", { name: "Stock level for Salt" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: "Set Salt to Low" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Set Salt to OK" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("does not invent a check date", () => {
    render(<SuppliesSection actions={supActions} supplies={[supply()]} />);
    expect(screen.getByText("Status not changed yet")).toBeTruthy();
  });

  it("offers adding to the shopping list only when something is low or out", () => {
    const { rerender } = render(<SuppliesSection actions={supActions} supplies={[supply()]} />);
    expect(screen.queryByRole("button", { name: "Add low/out items to shopping list" })).toBeNull();
    rerender(<SuppliesSection actions={supActions} supplies={[supply({ status: "out" })]} />);
    expect(screen.getByRole("button", { name: "Add low/out items to shopping list" })).toBeTruthy();
  });

  it("empty state", () => {
    render(<SuppliesSection actions={supActions} supplies={[]} />);
    expect(screen.getByText("No supplies tracked yet.")).toBeTruthy();
  });
});

describe("SuppliesCard", () => {
  it("lists out before low and counts open shopping items", () => {
    render(
      <SuppliesCard
        data={{
          totalSupplies: 3,
          openShoppingCount: 4,
          lowSupplies: [
            { id: uid(), name: "Soap", status: "low" },
            { id: uid(), name: "Bin bags", status: "out" },
          ],
        }}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Bin bags");
    expect(items[1]).toContain("Soap");
    expect(screen.getByText("open on the shopping list").parentElement?.textContent).toContain("4");
  });

  it("says nothing running low only when supplies exist", () => {
    const { rerender } = render(<SuppliesCard data={{ totalSupplies: 2, openShoppingCount: 0, lowSupplies: [] }} />);
    expect(screen.getByText("Nothing running low")).toBeTruthy();
    rerender(<SuppliesCard data={{ totalSupplies: 0, openShoppingCount: 0, lowSupplies: [] }} />);
    expect(screen.queryByText("Nothing running low")).toBeNull();
    expect(screen.getByText("No supplies tracked yet")).toBeTruthy();
  });

  it("shows an error note when data is unavailable", () => {
    render(<SuppliesCard data={null} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
