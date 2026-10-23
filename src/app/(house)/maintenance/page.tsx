import { requireSession } from "@/server/auth/session";
import { listMaintenance, listMaintenanceLog } from "@/server/data/maintenance";
import { MaintenanceList } from "@/components/maintenance/MaintenanceList";
import { ItemForm } from "@/components/maintenance/ItemForm";
import { Suggestions } from "@/components/maintenance/Suggestions";
import { todayInLondon } from "@/components/tasks/group";
import {
  addSuggestionAction, createItemAction, deleteItemAction, markDoneAction, updateItemAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const session = await requireSession();
  const [items, log] = await Promise.all([listMaintenance(), listMaintenanceLog()]);
  const actions = { update: updateItemAction, remove: deleteItemAction, done: markDoneAction };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Maintenance</h1>
      <section aria-label="Add a maintenance item" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Add a maintenance item</h2>
        <ItemForm action={createItemAction} submitLabel="Add item" />
      </section>
      {items.ok ? (
        <MaintenanceList
          items={items.data}
          log={log.ok ? log.data : []}
          logUnavailable={!log.ok}
          today={todayInLondon()}
          actions={actions}
          datePrefs={session.datePrefs}
        />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {items.error}
        </p>
      )}
      <Suggestions action={addSuggestionAction} existingTitles={items.ok ? items.data.map((i) => i.title) : []} />
    </div>
  );
}
