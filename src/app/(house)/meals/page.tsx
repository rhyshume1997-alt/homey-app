import { requireSession } from "@/server/auth/session";
import { listSupplyRefs, listWeek } from "@/server/data/meals";
import { MealsWeek } from "@/components/meals/MealsWeek";
import { resolveWeek, todayLondon } from "@/components/meals/types";
import { copyLastWeekAction, deleteMealAction, saveMealAction } from "./actions";
import { ImportFromLink } from "@/components/meals/ImportFromLink";
import { importRecipeFromText, importRecipePreview, saveImportedRecipeAction } from "./import-actions";

export const dynamic = "force-dynamic";

const alertCls = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg";

export default async function MealsPage({ searchParams }: { searchParams: Promise<{ w?: string | string[] }> }) {
  const session = await requireSession();
  const week = resolveWeek((await searchParams).w, todayLondon());
  const [meals, supplies] = await Promise.all([listWeek(week), listSupplyRefs()]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Meal planner</h1>
      <ImportFromLink
        week={week}
        meals={meals.ok ? meals.data : []}
        datePrefs={session.datePrefs}
        actions={{ preview: importRecipePreview, fromText: importRecipeFromText, save: saveImportedRecipeAction }}
      />
      {meals.ok ? (
        <MealsWeek
          week={week}
          meals={meals.data}
          supplies={supplies.ok ? supplies.data : []}
          datePrefs={session.datePrefs}
          actions={{ save: saveMealAction, remove: deleteMealAction, copyLastWeek: copyLastWeekAction }}
        />
      ) : (
        <p role="alert" className={alertCls}>{meals.error}</p>
      )}
    </div>
  );
}
