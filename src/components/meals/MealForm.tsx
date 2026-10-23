"use client";

import { useActionState, useState } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { MEAL_LIMITS, MEAL_SLOTS, SLOT_LABEL, type MealSlot, type MealWithIngredients, type SupplyRef } from "./types";

type Row = { k: number; name: string; quantity: string; price: string; supply: string };

const blank = (k: number): Row => ({ k, name: "", quantity: "", price: "", supply: "" });

/** Add or edit one meal with its ingredients. Ingredient fields are posted as aligned lists. */
export function MealForm({
  action,
  date,
  meal,
  supplies,
  submitLabel,
}: {
  action: FormAction;
  date: string;
  meal?: MealWithIngredients;
  supplies: SupplyRef[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [rows, setRows] = useState<Row[]>(() =>
    meal && meal.ingredients.length
      ? meal.ingredients.map((i, k) => ({
          k,
          name: i.name,
          quantity: i.quantity ?? "",
          price: i.unit_price_estimate === null ? "" : String(i.unit_price_estimate),
          supply: i.supply_id ?? "",
        }))
      : [blank(0)],
  );
  const [next, setNext] = useState(rows.length);
  const patch = (k: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.k === k ? { ...x, ...p } : x)));

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {meal && <input type="hidden" name="id" value={meal.id} />}
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Date
          <input type="date" name="planned_on" required defaultValue={meal?.planned_on ?? date} className={FIELD} />
        </label>
        <label className={LABEL}>
          Meal
          <select name="slot" defaultValue={(meal?.slot ?? "dinner") satisfies MealSlot} className={FIELD}>
            {MEAL_SLOTS.map((s) => (
              <option key={s} value={s}>{SLOT_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={LABEL}>
        What is on the menu
        <input name="title" required maxLength={MEAL_LIMITS.title} defaultValue={meal?.title ?? ""} className={FIELD} />
      </label>
      <label className={LABEL}>
        Notes (optional)
        <input name="notes" maxLength={MEAL_LIMITS.notes} defaultValue={meal?.notes ?? ""} className={FIELD} />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Ingredients</legend>
        {rows.map((r, n) => (
          <div key={r.k} data-testid="ingredient-row" className="flex flex-col gap-2 rounded-md bg-surface-muted p-3">
            <label className={LABEL}>
              Ingredient {n + 1}
              <input name="ing_name" maxLength={MEAL_LIMITS.name} value={r.name} onChange={(e) => patch(r.k, { name: e.target.value })} className={FIELD} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Quantity
                <input name="ing_quantity" maxLength={MEAL_LIMITS.quantity} value={r.quantity} onChange={(e) => patch(r.k, { quantity: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>
                Price estimate (£)
                <input name="ing_price" inputMode="decimal" value={r.price} onChange={(e) => patch(r.k, { price: e.target.value })} className={FIELD} />
              </label>
            </div>
            <label className={LABEL}>
              Linked supply (optional)
              <select name="ing_supply" value={r.supply} onChange={(e) => patch(r.k, { supply: e.target.value })} className={FIELD}>
                <option value="">None</option>
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            {rows.length > 1 && (
              <button type="button" className={`${BTN_SECONDARY} self-start`} onClick={() => setRows((x) => x.filter((y) => y.k !== r.k))}>
                Remove ingredient {n + 1}
              </button>
            )}
          </div>
        ))}
        {rows.length < MEAL_LIMITS.maxIngredients && (
          <button
            type="button"
            className={`${BTN_SECONDARY} self-start`}
            onClick={() => {
              setRows((x) => [...x, blank(next)]);
              setNext((n) => n + 1);
            }}
          >
            Add ingredient
          </button>
        )}
      </fieldset>

      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}
