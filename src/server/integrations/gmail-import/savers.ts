import "server-only";
import type { ApplianceSaver, ReadingSaver, SaveResult, SaverSession } from "@/contracts/email-import";
import { getSession, type HouseholdSession } from "@/server/auth/session";
import { saveApplianceDraft } from "@/server/data/appliances";
import { saveReadingDraft } from "@/server/data/meter-readings";
import { listRooms } from "@/server/data/rooms";

/**
 * Savers for the email import pages. Each write goes through the appliances / meter-readings data
 * layers under the caller's own session (RLS), is idempotent on the hashed message id, and only
 * stores fields a person confirmed. Nothing here guesses a value the email did not state.
 */

const FAILED = "Couldn't save that. Please try again.";

/** The saver session must be the signed-in member's own; household comes from the server session. */
async function sessionFor(s: SaverSession): Promise<HouseholdSession | null> {
  const session = await getSession();
  return session && session.userId === s.userId && session.householdId === s.householdId ? session : null;
}

async function roomIdFor(name: string | null): Promise<string | null> {
  if (!name) return null;
  const rooms = await listRooms();
  if (!rooms.ok) return null;
  return rooms.data.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

const applianceSaver: ApplianceSaver = {
  async save(s, a): Promise<SaveResult> {
    const session = await sessionFor(s);
    if (!session) return { ok: false, error: FAILED };
    const r = await saveApplianceDraft(session, {
      name: a.productName ?? (a.model ? `Bosch ${a.model}` : "Bosch appliance"),
      make: a.make,
      serial_last4: null,
      manual_document_id: null,
      receipt_document_id: null,
      model: a.model,
      purchase_date: a.purchaseDate,
      warranty_end: a.warrantyEnd,
      room_id: await roomIdFor(a.room),
      notes: a.warrantyEndSource === "computed" ? "Warranty end worked out from the purchase date and stated years." : null,
      source_message_hash: a.source.messageHash,
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};

const readingSaver: ReadingSaver = {
  async save(s, r): Promise<SaveResult> {
    const session = await sessionFor(s);
    if (!session) return { ok: false, error: FAILED };
    if (r.electricity.length > 1) {
      return { ok: false, error: "Day and night meters aren't supported yet. Add those readings by hand on Energy." };
    }
    if (r.gas && r.gas.unit !== "m3") {
      return { ok: false, error: "Only gas readings in m³ can be saved. Add this one by hand on Energy." };
    }
    if (!r.electricity.length && !r.gas) return { ok: false, error: "There's no reading to save." };
    const note = `From ${r.source.domain} email`;
    // One row per fuel; each gets its own idempotency key derived from the message hash.
    for (const e of r.electricity) {
      const res = await saveReadingDraft(session, {
        fuel: "electricity", read_on: r.readingDate, value: e.kwh, unit: "kWh", note,
        source_message_hash: `${r.source.messageHash}:electricity`,
      });
      if (!res.ok) return { ok: false, error: res.error };
    }
    if (r.gas) {
      const res = await saveReadingDraft(session, {
        fuel: "gas", read_on: r.readingDate, value: r.gas.value, unit: "m3", note,
        source_message_hash: `${r.source.messageHash}:gas`,
      });
      if (!res.ok) return { ok: false, error: res.error };
    }
    return { ok: true };
  },
};

export function importSavers(): { appliance: ApplianceSaver; reading: ReadingSaver } {
  return { appliance: applianceSaver, reading: readingSaver };
}
