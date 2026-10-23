// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IngredientsNeeded } from "@/components/meals/IngredientsNeeded";
import { MealsWeek } from "@/components/meals/MealsWeek";
import {
  addDays, aggregateNeeded, mondayOf, resolveWeek, totalsOf,
  type Ingredient, type MealActions, type MealWithIngredients, type SupplyRef,
} from "@/components/meals/types";
import { parseMealForm } from "@/contracts/meals";

afterEach(cleanup);

const noop = async () => null;
const actions: MealActions = { save: noop, remove: noop, copyLastWeek: noop };

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const ing = (name: string, o: Partial<Ingredient> = {}): Ingredient => ({
  id: uid(), meal_id: "m", name, quantity: null, unit_price_estimate: null, supply_id: null, ...o,
});
const meal = (title: string, planned_on: string, ingredients: Ingredient[] = [], slot: "lunch" | "dinner" = "dinner"): MealWithIngredients => ({
  id: uid(), planned_on, slot, title, notes: null, ingredients,
});
const sup = (name: string, status: SupplyRef["status"], id = uid()): SupplyRef => ({ id, name, status });

describe("week maths", () => {
  it("finds Monday and resolves bad input to the current week", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(addDays("2026-10-19", 7)).toBe("2026-10-26");
    expect(resolveWeek("2026-10-22", "2026-01-01")).toBe("2026-10-19");
    expect(resolveWeek("nonsense", "2026-10-22")).toBe("2026-10-19");
    expect(resolveWeek("2026-02-31", "2026-10-22")).toBe("2026-10-19");
    expect(resolveWeek(undefined, "2026-10-22")).toBe("2026-10-19");
  });
});

describe("aggregateNeeded", () => {
  it("merges by normalised name and never assumes stock", () => {
    const items = aggregateNeeded(
      [meal("Pasta", "2026-10-19", [ing("Onion", { quantity: "2" })]), meal("Curry", "2026-10-20", [ing("  onion ", { quantity: "1" }), ing("Rice")])],
      [],
    );
    expect(items.map((i) => [i.name, i.quantity, i.status])).toEqual([
      ["Onion", "2 + 1", "need"],
      ["Rice", null, "need"],
    ]);
  });

  it("In for ok, Low for low, Need for out, by name or link", () => {
    const linked = uid();
    const items = aggregateNeeded(
      [meal("A", "2026-10-19", [ing("salt"), ing("Flour"), ing("Oil"), ing("Fancy name", { supply_id: linked })])],
      [sup("Salt", "ok"), sup("flour", "low"), sup("OIL", "out"), sup("Unrelated", "ok", linked)],
    );
    const by = Object.fromEntries(items.map((i) => [i.name, i.status]));
    expect(by).toEqual({ salt: "in", Flour: "low", Oil: "need", "Fancy name": "in" });
  });

  it("totals count only known prices of missing items", () => {
    const items = aggregateNeeded(
      [meal("A", "2026-10-19", [ing("Eggs", { unit_price_estimate: 2.5 }), ing("Milk"), ing("Salt", { unit_price_estimate: 9 })])],
      [sup("Salt", "ok")],
    );
    expect(totalsOf(items)).toEqual({ needed: 3, in: 1, missing: 2, estimate: 2.5, pricesUnknown: 1 });
  });
});

describe("parseMealForm", () => {
  it("zips aligned ingredient fields and drops blank rows", () => {
    const fd = new FormData();
    fd.set("planned_on", "2026-10-20");
    fd.set("title", " Tacos ");
    for (const [a, b, c] of [["Mince", "500g", "3.2"], ["", "", ""], ["Wraps", "", ""]]) {
      fd.append("ing_name", a!);
      fd.append("ing_quantity", b!);
      fd.append("ing_price", c!);
      fd.append("ing_supply", "");
    }
    const r = parseMealForm(fd);
    expect(r?.title).toBe("Tacos");
    expect(r?.slot).toBe("dinner");
    expect(r?.ingredients).toEqual([
      { name: "Mince", quantity: "500g", unit_price_estimate: 3.2, supply_id: null },
      { name: "Wraps", quantity: null, unit_price_estimate: null, supply_id: null },
    ]);
  });

  it("rejects bad dates, long titles and negative prices", () => {
    const base = (o: Record<string, string>) => {
      const fd = new FormData();
      fd.set("planned_on", "2026-10-20");
      fd.set("title", "x");
      for (const [k, v] of Object.entries(o)) fd.set(k, v);
      return fd;
    };
    expect(parseMealForm(base({ planned_on: "2026-13-01" }))).toBeNull();
    expect(parseMealForm(base({ title: "x".repeat(81) }))).toBeNull();
    expect(parseMealForm(base({ ing_name: "a", ing_price: "-1" }))).toBeNull();
    expect(parseMealForm(base({ slot: "breakfast" }))).toBeNull();
  });
});

describe("MealsWeek", () => {
  it("shows seven days, meals with ingredients and Copy last week", () => {
    render(
      <MealsWeek
        week="2026-10-19"
        supplies={[]}
        actions={actions}
        meals={[meal("Lasagne", "2026-10-21", [ing("Pasta sheets", { quantity: "1 box" })])]}
      />,
    );
    expect(screen.getAllByTestId("meal-day")).toHaveLength(7);
    const row = screen.getByTestId("meal-row");
    expect(within(row).getByText("Lasagne")).toBeTruthy();
    expect(within(row).getByText("Pasta sheets (1 box)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy last week" })).toBeTruthy();
    expect(screen.getAllByText("Nothing planned.")).toHaveLength(6);
  });

  it("the add form can grow ingredient rows", () => {
    render(<MealsWeek week="2026-10-19" supplies={[]} actions={actions} meals={[]} />);
    const mon = screen.getAllByTestId("meal-day")[0]!;
    expect(within(mon).getAllByTestId("ingredient-row")).toHaveLength(1);
    fireEvent.click(within(mon).getByRole("button", { name: "Add ingredient" }));
    expect(within(mon).getAllByTestId("ingredient-row")).toHaveLength(2);
  });
});

describe("IngredientsNeeded", () => {
  const items = aggregateNeeded(
    [meal("A", "2026-10-19", [ing("Eggs", { unit_price_estimate: 2 }), ing("Milk"), ing("Salt"), ing("Flour")])],
    [sup("Salt", "ok"), sup("Flour", "low")],
  );

  it("shows pills, totals and an estimate with unknown prices", () => {
    render(<IngredientsNeeded week="2026-10-19" items={items} addMissing={noop} />);
    expect(screen.getByTestId("totals").textContent).toBe("4 needed · 1 in · 3 missing");
    expect(screen.getByTestId("estimate").textContent).toBe("£2.00 est. · 2 prices unknown");
    const rows = screen.getAllByTestId("needed-row");
    expect(rows.map((r) => within(r).getByText(/^(In|Low|Need)$/).textContent)).toEqual(["Need", "Need", "Low", "In"]);
  });

  it("asks for confirmation listing the missing items before adding", () => {
    render(<IngredientsNeeded week="2026-10-19" items={items} addMissing={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add 3 missing to shopping" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Eggs")).toBeTruthy();
    expect(within(dialog).queryByText("Salt")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Confirm add 3" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has an empty state and no add button when nothing is missing", () => {
    const { unmount } = render(<IngredientsNeeded week="2026-10-19" items={[]} addMissing={noop} />);
    expect(screen.getByText(/No ingredients planned/)).toBeTruthy();
    unmount();
    render(<IngredientsNeeded week="2026-10-19" items={aggregateNeeded([meal("A", "2026-10-19", [ing("Salt")])], [sup("Salt", "ok")])} addMissing={noop} />);
    expect(screen.queryByRole("button", { name: /missing to shopping/ })).toBeNull();
    expect(screen.queryByTestId("estimate")).toBeNull();
  });
});
