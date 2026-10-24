// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Form actions in jsdom can take over a second when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 3000 });
import { ImportFromLink, type ImportActions } from "@/components/meals/ImportFromLink";
import type { Meal } from "@/components/meals/types";
import type { PreviewResult } from "@/contracts/recipe-import";
import type { FormState } from "@/components/tasks/types";

afterEach(cleanup);

const WEEK = "2026-10-19";
const meals: Meal[] = [{ id: "11111111-1111-4111-8111-111111111111", planned_on: "2026-10-20", slot: "dinner", title: "Pasta night", notes: null }];
const ok: PreviewResult = {
  ok: true,
  preview: {
    title: "Tomato pasta",
    source: "website",
    ingredients: [
      { name: "chopped tomatoes", quantity: "2 tins" },
      { name: "pasta", quantity: "200g" },
      { name: "salt", quantity: null },
    ],
  },
};

function setup(over: Partial<ImportActions> = {}, list: Meal[] = meals) {
  const posted: FormData[] = [];
  const actions: ImportActions = {
    preview: vi.fn(async () => ok),
    fromText: vi.fn(async () => ok),
    save: vi.fn(async (_p: FormState, fd: FormData) => (posted.push(fd), { ok: true })),
    ...over,
  };
  render(<ImportFromLink week={WEEK} meals={list} actions={actions} />);
  return { actions, posted };
}

async function openAndFetch(url = "https://recipes.example/pasta?utm_source=x") {
  fireEvent.click(screen.getByRole("button", { name: "Add from a link" }));
  const dialog = screen.getByRole("dialog", { name: "Add from a link" });
  const fetchBtn = within(dialog).getByRole("button", { name: "Fetch" });
  expect(fetchBtn).toHaveProperty("disabled", true);
  fireEvent.change(within(dialog).getByLabelText("Recipe, TikTok or Instagram link"), { target: { value: url } });
  fireEvent.click(fetchBtn);
  return dialog;
}

describe("ImportFromLink", () => {
  it("is closed until the button is pressed", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Add from a link" }).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("fetches a preview, then saves only ticked rows with edited quantities to the chosen meal", async () => {
    const { actions, posted } = setup();
    const dialog = await openAndFetch();
    expect(actions.preview).toHaveBeenCalledWith("https://recipes.example/pasta?utm_source=x");
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    expect(within(dialog).getAllByTestId("import-row")).toHaveLength(3);

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include salt" }));
    expect(within(dialog).getByLabelText("Ingredient 3 name")).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByLabelText("Quantity for pasta"), { target: { value: "300g" } });

    const add = within(dialog).getByRole("button", { name: "Add to Pasta night" });
    fireEvent.click(add);
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const fd = posted[0];
    expect(fd.get("mode")).toBe("existing");
    expect(fd.get("meal_id")).toBe(meals[0].id);
    expect(fd.getAll("imp_name")).toEqual(["chopped tomatoes", "pasta"]);
    expect(fd.getAll("imp_quantity")).toEqual(["2 tins", "300g"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Added to Pasta night.");
  });

  it("adds as a new meal with date, slot, title and a query-free source note", async () => {
    const { posted, actions } = setup();
    const dialog = await openAndFetch();
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "A new meal" }));
    expect((within(dialog).getByLabelText("What is on the menu") as HTMLInputElement).value).toBe("Tomato pasta");
    expect((within(dialog).getByLabelText("Notes (optional)") as HTMLInputElement).value).toBe("From https://recipes.example/pasta");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add as new meal" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const fd = posted[0];
    expect(fd.get("mode")).toBe("new");
    expect(fd.get("slot")).toBe("dinner");
    expect(String(fd.get("planned_on"))).toMatch(/^2026-10-(19|2\d)$/);
    expect(fd.get("meal_id")).toBeNull();
  });

  it("only offers a new meal when the week is empty", async () => {
    setup({}, []);
    const dialog = await openAndFetch();
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    expect(within(dialog).queryByRole("radio", { name: "A meal this week" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Add as new meal" })).toBeTruthy();
  });

  it("disables the add button when nothing is ticked", async () => {
    setup();
    const dialog = await openAndFetch();
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    for (const n of ["chopped tomatoes", "pasta", "salt"]) fireEvent.click(within(dialog).getByRole("checkbox", { name: `Include ${n}` }));
    expect(within(dialog).getByRole("button", { name: "Add to Pasta night" })).toHaveProperty("disabled", true);
  });

  it("shows the server's error and keeps the sheet open", async () => {
    setup({ save: vi.fn(async () => ({ error: "That meal is no longer on the planner." })) });
    const dialog = await openAndFetch();
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to Pasta night" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("That meal is no longer on the planner.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("on a failed link (e.g. Instagram) explains and opens the paste box, which uses the same extractor", async () => {
    const msg = "Instagram doesn't share post captions with apps like this one.";
    const { actions } = setup({ preview: vi.fn(async (): Promise<PreviewResult> => ({ ok: false, error: msg, source: "instagram" })) });
    const dialog = await openAndFetch("https://www.instagram.com/reel/abc/");
    expect((await within(dialog).findByRole("alert")).textContent).toBe(msg);
    const box = within(dialog).getByLabelText("Paste the caption or recipe text");
    fireEvent.change(box, { target: { value: "Ingredients:\n200g pasta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Find ingredients" }));
    await waitFor(() => expect(actions.fromText).toHaveBeenCalledWith("Ingredients:\n200g pasta"));
    await within(dialog).findByRole("form", { name: "Ingredients found" });
  });

  it("offers the paste box up front too", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add from a link" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste the recipe text instead" }));
    expect(screen.getByLabelText("Paste the caption or recipe text")).toBeTruthy();
  });

  it("closes on Escape and with the Close button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add from a link" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add from a link" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses 44px targets and 16px fields", async () => {
    setup();
    const dialog = await openAndFetch();
    await within(dialog).findByRole("form", { name: "Ingredients found" });
    for (const el of dialog.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) {
      expect(el.className).toContain("text-base");
      expect(el.className).toContain("min-h-[var(--touch-target)]");
    }
    for (const el of dialog.querySelectorAll("input[type=checkbox], input[type=radio]")) expect(el.className).toMatch(/h-11 w-11/);
    for (const el of dialog.querySelectorAll("button")) expect(el.className).toContain("min-h-[var(--touch-target)]");
  });
});
