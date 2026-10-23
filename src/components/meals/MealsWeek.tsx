import Link from "next/link";
import { formatDate, type DatePrefs } from "@/components/dates";
import { ActionButton } from "@/components/shopping/ActionButton";
import { MealForm } from "./MealForm";
import {
  DAY_NAMES, SLOT_LABEL, addDays, weekDays, type MealActions, type MealWithIngredients, type SupplyRef,
} from "./types";

const LINK = "min-h-[var(--touch-target)] inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-base font-medium";

function MealItem({ meal, actions, supplies }: { meal: MealWithIngredients; actions: MealActions; supplies: SupplyRef[] }) {
  return (
    <li data-testid="meal-row" className="rounded-md bg-surface-muted px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{SLOT_LABEL[meal.slot]}</p>
      <p className="font-medium">{meal.title}</p>
      {meal.notes && <p className="text-sm text-muted">{meal.notes}</p>}
      {meal.ingredients.length > 0 && (
        <p className="text-sm text-muted">
          {meal.ingredients.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(", ")}
        </p>
      )}
      <details className="mt-2">
        <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Edit {meal.title}</summary>
        <MealForm action={actions.save} date={meal.planned_on} meal={meal} supplies={supplies} submitLabel="Save changes" />
      </details>
      <details>
        <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Delete {meal.title}</summary>
        <ActionButton
          action={actions.remove}
          id={meal.id}
          label="Confirm delete"
          ariaLabel={`Confirm delete ${meal.title}`}
          variant="danger"
        />
      </details>
    </li>
  );
}

/** Monday to Sunday. Each day lists its meals and offers an add form. */
export function MealsWeek({
  week,
  meals,
  supplies,
  actions,
  datePrefs,
}: {
  week: string;
  meals: MealWithIngredients[];
  supplies: SupplyRef[];
  actions: MealActions;
  datePrefs?: DatePrefs;
}) {
  const days = weekDays(week);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <Link href={`/meals?w=${addDays(week, -7)}`} className={LINK}>Previous week</Link>
        <p className="flex-1 text-center font-medium" data-testid="week-label">
          Week of {formatDate(week, datePrefs)}
        </p>
        <Link href={`/meals?w=${addDays(week, 7)}`} className={LINK}>Next week</Link>
      </nav>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={actions.copyLastWeek} extra={{ week }} label="Copy last week" />
        <Link href={`/meals/ingredients?w=${week}`} className={LINK}>Ingredients needed</Link>
      </div>
      <ol className="flex flex-col gap-3">
        {days.map((d, i) => {
          const list = meals.filter((m) => m.planned_on === d);
          return (
            <li key={d} data-testid="meal-day" className="rounded-lg border border-border bg-surface p-3">
              <h2 className="text-base font-semibold">
                {DAY_NAMES[i]} <span className="font-normal text-muted">{formatDate(d, datePrefs)}</span>
              </h2>
              {list.length === 0 ? (
                <p className="py-1 text-sm text-muted">Nothing planned.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {list.map((m) => (
                    <MealItem key={m.id} meal={m} actions={actions} supplies={supplies} />
                  ))}
                </ul>
              )}
              <details className="mt-1">
                <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Add a meal on {DAY_NAMES[i]}</summary>
                <MealForm action={actions.save} date={d} supplies={supplies} submitLabel="Add meal" />
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
