import { requireSession } from "@/server/auth/session";
import { listChecklist } from "@/server/data/checklist";
import { ChecklistSection } from "@/components/checklist/ChecklistSection";
import { addChecklistTaskAction, markChecklistDoneAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChecklistPage() {
  const session = await requireSession();
  const items = await listChecklist();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Seasonal checklist</h1>
      {items.ok ? (
        <ChecklistSection
          items={items.data}
          today={today}
          datePrefs={session.datePrefs}
          actions={{ markDone: markChecklistDoneAction, addTask: addChecklistTaskAction }}
        />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {items.error}
        </p>
      )}
    </div>
  );
}
