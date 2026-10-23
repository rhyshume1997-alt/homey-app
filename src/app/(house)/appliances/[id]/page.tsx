import { todayInLondon } from "@/server/data/dashboard";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { getAppliance, listDocumentOptions, listRoomOptions, parseApplianceId } from "@/server/data/appliances";
import { ApplianceDetail } from "@/components/appliances/ApplianceDetail";
import { ApplianceForm } from "@/components/appliances/ApplianceForm";
import { ServiceTaskButton } from "@/components/appliances/ServiceTaskButton";
import { RowAction } from "@/components/tasks/RowAction";
import { createServiceTaskAction, deleteApplianceAction, updateApplianceAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ApplianceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const id = parseApplianceId((await params).id);
  if (!id) notFound();
  const appliance = await getAppliance(id);
  if (!appliance) notFound();
  const [rooms, documents] = await Promise.all([listRoomOptions(), listDocumentOptions()]);
  const today = todayInLondon();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{appliance.name}</h1>
      <ApplianceDetail
        appliance={appliance}
        roomName={rooms.find((r) => r.id === appliance.room_id)?.name}
        manualTitle={documents.find((d) => d.id === appliance.manual_document_id)?.title}
        receiptTitle={documents.find((d) => d.id === appliance.receipt_document_id)?.title}
        today={today}
        prefs={session.datePrefs}
      />
      <ServiceTaskButton action={createServiceTaskAction} applianceId={appliance.id} applianceName={appliance.name} />
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-semibold">Edit</h2>
        <ApplianceForm action={updateApplianceAction} appliance={appliance} rooms={rooms} documents={documents} submitLabel="Save changes" />
      </section>
      <RowAction action={deleteApplianceAction} id={appliance.id} label="Delete appliance" variant="danger" />
    </div>
  );
}
