import { requireSession } from "@/server/auth/session";
import { getIngredientsNeeded } from "@/server/data/meals";
import { IngredientsNeeded } from "@/components/meals/IngredientsNeeded";
import { resolveWeek, todayLondon } from "@/components/meals/types";
import { addMissingToShoppingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ w?: string | string[] }> }) {
  const session = await requireSession();
  const week = resolveWeek((await searchParams).w, todayLondon());
  const needed = await getIngredientsNeeded(week);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ingredients needed</h1>
      {needed.ok ? (
        <IngredientsNeeded week={week} items={needed.data.items} addMissing={addMissingToShoppingAction} datePrefs={session.datePrefs} />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {needed.error}
        </p>
      )}
    </div>
  );
}
