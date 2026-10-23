import Link from "next/link";
import { todayInLondon } from "@/server/data/dashboard";
import { requireSession } from "@/server/auth/session";
import { listAppliances, listDocumentOptions, listRoomOptions } from "@/server/data/appliances";
import { ApplianceList } from "@/components/appliances/ApplianceList";
import { ApplianceForm } from "@/components/appliances/ApplianceForm";
import { createApplianceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppliancesPage() {
  const session = await requireSession();
  const [list, rooms, documents] = await Promise.all([listAppliances(), listRoomOptions(), listDocumentOptions()]);
  const today = todayInLondon();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Appliances and warranties</h1>
        <Link href="/import/appliances" className="inline-flex min-h-[var(--touch-target)] items-center text-sm font-medium text-accent underline underline-offset-2">Import from email</Link>
      </div>
      {list.ok ? (
        <ApplianceList
          appliances={list.data}
          rooms={Object.fromEntries(rooms.map((r) => [r.id, r.name]))}
          today={today}
          prefs={session.datePrefs}
        />
      ) : (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">{list.error}</p>
      )}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Add an appliance</h2>
        <ApplianceForm action={createApplianceAction} rooms={rooms} documents={documents} submitLabel="Add appliance" />
      </section>
    </div>
  );
}
