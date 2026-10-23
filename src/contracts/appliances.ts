import { z } from "zod";

/** Limits mirror the appliances migration (20261024120000). */
export const APPLIANCE_LIMITS = { name: 80, make: 60, model: 60, serial: 4, notes: 500 } as const;

export const ApplianceSourceSchema = z.enum(["manual", "email"]);

/** Blank strings become null before validation. */
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)), schema.nullable());

export const ApplianceSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  room_id: z.uuid().nullable(),
  name: z.string().min(1).max(APPLIANCE_LIMITS.name),
  make: z.string().nullable(),
  model: z.string().nullable(),
  serial_last4: z.string().nullable(),
  purchase_date: z.iso.date().nullable(),
  warranty_end: z.iso.date().nullable(),
  source: ApplianceSourceSchema,
  manual_document_id: z.uuid().nullable(),
  receipt_document_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Appliance = z.infer<typeof ApplianceSchema>;

/** Form and email-draft input. household_id and source are never taken from the client. */
export const ApplianceInputSchema = z.object({
  name: z.string().trim().min(1).max(APPLIANCE_LIMITS.name),
  make: opt(z.string().trim().max(APPLIANCE_LIMITS.make)),
  model: opt(z.string().trim().max(APPLIANCE_LIMITS.model)),
  /** The last four characters of the serial only. A full serial number is rejected. */
  serial_last4: opt(z.string().trim().regex(/^[A-Za-z0-9]{4}$/)),
  purchase_date: opt(z.iso.date()),
  warranty_end: opt(z.iso.date()),
  room_id: opt(z.uuid()),
  manual_document_id: opt(z.uuid()),
  receipt_document_id: opt(z.uuid()),
  notes: opt(z.string().trim().max(APPLIANCE_LIMITS.notes)),
});
export type ApplianceInput = z.infer<typeof ApplianceInputSchema>;

/** What the email-import builder hands over. The hash identifies the message; the email is never stored. */
export const ApplianceDraftSchema = ApplianceInputSchema.extend({
  source_message_hash: z.string().trim().min(8).max(128),
});
export type ApplianceDraft = z.input<typeof ApplianceDraftSchema>;

/** Calendar entry for a warranty end. */
export type WarrantyEnd = { id: string; name: string; warranty_end: string };
