import { requireSession } from "@/server/auth/session";
import { getEnergy } from "@/server/data/energy";
import { listReadings } from "@/server/data/meter-readings";
import { todayInLondon } from "@/server/data/dashboard";
import { EnergySections } from "@/components/energy/EnergySections";
import { ReadingsSection } from "@/components/energy/ReadingsSection";
import { addReadingAction, removeReadingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EnergyPage() {
  const session = await requireSession();
  const [res, readings] = await Promise.all([getEnergy(), listReadings()]);
  const today = todayInLondon();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Energy and solar</h1>
      <p className="text-sm text-muted">
        Imported figures are as recorded in the household record. Only the Readings section below comes from meter readings
        you entered.
      </p>
      <ReadingsSection
        readings={readings.ok ? readings.data : null}
        today={today}
        datePrefs={session.datePrefs}
        actions={{ add: addReadingAction, remove: removeReadingAction }}
      />
      <EnergySections data={res.ok ? res.data : null} today={today} datePrefs={session.datePrefs} />
    </div>
  );
}
