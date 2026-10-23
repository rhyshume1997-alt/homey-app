import Link from "next/link";
import type { Appliance } from "@/contracts/appliances";
import type { DatePrefs } from "@/components/dates";
import { WarrantyPill } from "./ApplianceList";

/** Appliances in one room, for the room page. Pass `listAppliancesForRoom(roomId)`. */
export function RoomAppliances({ appliances, today, prefs }: { appliances: Appliance[]; today: string; prefs: DatePrefs }) {
  return (
    <section aria-label="Appliances" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Appliances</h2>
      {appliances.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No appliances in this room.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {appliances.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2">
              <Link href={`/appliances/${a.id}`} className="inline-flex min-h-11 min-w-11 items-center font-medium underline-offset-2 hover:underline">{a.name}</Link>
              <WarrantyPill warrantyEnd={a.warranty_end} today={today} prefs={prefs} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
