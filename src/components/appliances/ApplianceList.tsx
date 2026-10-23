import Link from "next/link";
import type { Appliance } from "@/contracts/appliances";
import { formatDate, type DatePrefs } from "@/components/dates";
import { LIGHT_ORDER, trafficLight, type Light } from "@/components/status";
import { StatusPill } from "@/components/ui/StatusPill";

export function warrantyLight(a: Pick<Appliance, "warranty_end">, today: string): Light | null {
  return a.warranty_end ? trafficLight("warranty", a.warranty_end, today) : null;
}

export function WarrantyPill({ warrantyEnd, today, prefs }: { warrantyEnd: string | null; today: string; prefs: DatePrefs }) {
  if (!warrantyEnd) return <span className="text-sm text-muted">No warranty date</span>;
  const light = trafficLight("warranty", warrantyEnd, today);
  const label = light === "red" ? `Expired ${formatDate(warrantyEnd, prefs)}` : `Warranty to ${formatDate(warrantyEnd, prefs)}`;
  return <StatusPill light={light} label={label} />;
}

export function ApplianceList({
  appliances, rooms, today, prefs,
}: { appliances: Appliance[]; rooms: Record<string, string>; today: string; prefs: DatePrefs }) {
  if (appliances.length === 0) {
    return <p className="text-sm text-muted">No appliances yet. Add the first one.</p>;
  }
  const sorted = [...appliances].sort((x, y) => {
    const lx = warrantyLight(x, today);
    const ly = warrantyLight(y, today);
    return (lx ? LIGHT_ORDER[lx] : 3) - (ly ? LIGHT_ORDER[ly] : 3) || x.name.localeCompare(y.name);
  });
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((a) => (
        <li key={a.id} data-testid="appliance-row" className="rounded-md bg-surface-muted px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/appliances/${a.id}`} className="inline-flex min-h-11 min-w-11 items-center break-words font-medium underline-offset-2 hover:underline">
              {a.name}
            </Link>
            <WarrantyPill warrantyEnd={a.warranty_end} today={today} prefs={prefs} />
          </div>
          <p className="text-sm text-muted">
            {[[a.make, a.model].filter(Boolean).join(" "), a.room_id ? rooms[a.room_id] : undefined].filter(Boolean).join(" · ") ||
              "No details yet"}
          </p>
        </li>
      ))}
    </ul>
  );
}
