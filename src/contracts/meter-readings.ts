import { z } from "zod";

/** Meter readings. Limits mirror the meter_readings migration. */
export const METER_FUELS = ["electricity", "gas"] as const;
export const METER_UNITS = ["kWh", "m3"] as const;
export const METER_SOURCES = ["manual", "email"] as const;
export const METER_LIMITS = { note: 200, hash: 200, maxValue: 999_999_999.999 } as const;

export type MeterFuel = (typeof METER_FUELS)[number];
export type MeterUnit = (typeof METER_UNITS)[number];
export type MeterSource = (typeof METER_SOURCES)[number];

export type MeterReading = {
  id: string;
  fuel: MeterFuel;
  read_on: string; // YYYY-MM-DD
  value: number;
  unit: MeterUnit;
  source: MeterSource;
  note: string | null;
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });

/** What a person (or a confirmed email draft) supplies. The server stamps household and source. */
export const MeterReadingInputSchema = z.object({
  fuel: z.enum(METER_FUELS),
  read_on: isoDate,
  value: z.number().finite().min(0).max(METER_LIMITS.maxValue),
  unit: z.enum(METER_UNITS),
  note: z.string().trim().max(METER_LIMITS.note).nullish(),
});
export type MeterReadingInput = z.infer<typeof MeterReadingInputSchema>;

/** A reading proposed from an email. Saved only through saveReadingDraft, idempotent on the hash. */
export const MeterReadingDraftSchema = MeterReadingInputSchema.extend({
  source_message_hash: z.string().min(1).max(METER_LIMITS.hash),
});
export type MeterReadingDraft = z.infer<typeof MeterReadingDraftSchema>;
