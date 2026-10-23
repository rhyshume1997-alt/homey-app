import { requireSession } from "@/server/auth/session";
import { listEmergencyItems } from "@/server/data/emergency";
import { EmergencyCard } from "@/components/emergency/EmergencyCard";
import { addEmergencyItemAction, removeEmergencyItemAction, updateEmergencyItemAction } from "./actions";

export const dynamic = "force-dynamic";

const alertCls = "rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-lg font-medium text-warning-fg";

export default async function EmergencyPage() {
  await requireSession();
  const items = await listEmergencyItems();
  return (
    <div className="flex flex-col gap-4 p-4 text-lg">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">Emergency</h1>
        <p className="text-lg text-muted">Keep this up to date. Placeholders say Not set yet.</p>
      </div>
      {items.ok ? (
        <EmergencyCard
          items={items.data}
          actions={{ add: addEmergencyItemAction, update: updateEmergencyItemAction, remove: removeEmergencyItemAction }}
        />
      ) : (
        <p role="alert" className={alertCls}>{items.error}</p>
      )}
    </div>
  );
}
