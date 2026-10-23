import "server-only";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import {
  ApplianceDraftSchema, ApplianceInputSchema, ApplianceSchema,
  type Appliance, type ApplianceDraft, type ApplianceInput, type WarrantyEnd,
} from "@/contracts/appliances";
import { createTask } from "@/server/data/tasks";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load appliances right now.",
} as const;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : null);

export function parseApplianceForm(fd: FormData): ApplianceInput | null {
  const r = ApplianceInputSchema.safeParse({
    name: fd.get("name") ?? "",
    make: text(fd.get("make")),
    model: text(fd.get("model")),
    serial_last4: text(fd.get("serial_last4")),
    purchase_date: text(fd.get("purchase_date")),
    warranty_end: text(fd.get("warranty_end")),
    room_id: text(fd.get("room_id")),
    manual_document_id: text(fd.get("manual_document_id")),
    receipt_document_id: text(fd.get("receipt_document_id")),
    notes: text(fd.get("notes")),
  });
  return r.success ? r.data : null;
}

export function parseApplianceId(v: unknown): string | null {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
}

const COLUMNS =
  "id, household_id, room_id, name, make, model, serial_last4, purchase_date, warranty_end, source, manual_document_id, receipt_document_id, notes, created_at, updated_at";

export async function listAppliances(): Promise<Result<Appliance[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db.from("appliances").select(COLUMNS).order("name").limit(1000);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(ApplianceSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

/** Null when it does not exist or is not visible under RLS. */
export async function getAppliance(id: string): Promise<Appliance | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data } = await db.from("appliances").select(COLUMNS).eq("id", id).maybeSingle();
  const parsed = ApplianceSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function listAppliancesForRoom(roomId: string): Promise<Appliance[]> {
  if (!parseApplianceId(roomId)) return [];
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db.from("appliances").select(COLUMNS).eq("room_id", roomId).order("name").limit(200);
  const parsed = z.array(ApplianceSchema).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

/** Warranty end dates for the calendar. Only dates a person (or an import) recorded. */
export async function listWarrantyEnds(): Promise<WarrantyEnd[]> {
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db
    .from("appliances")
    .select("id, name, warranty_end")
    .not("warranty_end", "is", null)
    .order("warranty_end")
    .limit(1000);
  const parsed = z
    .array(z.object({ id: z.uuid(), name: z.string(), warranty_end: z.iso.date() }))
    .safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

export async function listRoomOptions(): Promise<{ id: string; name: string }[]> {
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db.from("rooms").select("id, name").order("sort_order").order("name").limit(200);
  const parsed = z.array(z.object({ id: z.uuid(), name: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

export async function listDocumentOptions(): Promise<{ id: string; title: string }[]> {
  const db = await createUserClient();
  if (!db) return [];
  const { data } = await db.from("documents").select("id, title").order("title").limit(1000);
  const parsed = z.array(z.object({ id: z.uuid(), title: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

const row = (i: ApplianceInput) => ({
  name: i.name,
  make: i.make ?? null,
  model: i.model ?? null,
  serial_last4: i.serial_last4 ?? null,
  purchase_date: i.purchase_date ?? null,
  warranty_end: i.warranty_end ?? null,
  room_id: i.room_id ?? null,
  manual_document_id: i.manual_document_id ?? null,
  receipt_document_id: i.receipt_document_id ?? null,
  notes: i.notes ?? null,
});

export async function createAppliance(s: HouseholdSession, i: ApplianceInput): Promise<Result<{ id: string }>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("appliances")
    .insert({ ...row(i), household_id: s.householdId, source: "manual", created_by: s.userId })
    .select("id")
    .single();
  return error || !data ? { ok: false, error: MSG.failed } : { ok: true, data: { id: data.id } };
}

export async function updateAppliance(s: HouseholdSession, id: string, i: ApplianceInput): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("appliances")
    .update(row(i))
    .eq("id", id)
    .eq("household_id", s.householdId)
    .select("id");
  return error || !data || data.length === 0 ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function deleteAppliance(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("appliances")
    .delete()
    .eq("id", id)
    .eq("household_id", s.householdId)
    .select("id");
  return error || !data || data.length === 0 ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

/**
 * The save path for email-import drafts. Validates, then inserts with source 'email'.
 * Idempotent on (household, source_message_hash): a repeat returns the existing row with created=false.
 * Only call this after the person has confirmed the draft.
 */
export async function saveApplianceDraft(
  s: HouseholdSession,
  draft: ApplianceDraft,
): Promise<Result<{ id: string; created: boolean }>> {
  const parsed = ApplianceDraftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: MSG.invalid };
  const { source_message_hash: hash, ...input } = parsed.data;
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };

  const existing = async () => {
    const { data } = await db
      .from("appliances")
      .select("id")
      .eq("household_id", s.householdId)
      .eq("source_message_hash", hash)
      .maybeSingle();
    return data?.id ?? null;
  };
  const found = await existing();
  if (found) return { ok: true, data: { id: found, created: false } };

  const { data, error } = await db
    .from("appliances")
    .insert({ ...row(input), household_id: s.householdId, source: "email", source_message_hash: hash, created_by: s.userId })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const raced = await existing(); // a concurrent save won
      if (raced) return { ok: true, data: { id: raced, created: false } };
    }
    return { ok: false, error: MSG.failed };
  }
  return { ok: true, data: { id: data.id, created: true } };
}

/** Creates a service task for an appliance. The caller must have had the person confirm it. */
export async function createServiceTask(
  s: HouseholdSession,
  applianceId: string,
  dueDate: string | null,
): Promise<Result> {
  const due = z.iso.date().nullable().safeParse(dueDate);
  if (!due.success) return { ok: false, error: MSG.invalid };
  const a = await getAppliance(applianceId);
  if (!a) return { ok: false, error: MSG.invalid };
  return createTask(s, {
    title: `Service: ${a.name}`.slice(0, 200),
    notes: null,
    assignee_user_id: null,
    due_date: due.data,
    recurrence: "none",
  });
}
