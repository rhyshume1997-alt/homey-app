import "server-only";
import { z } from "zod";
import { IMPORT_LIMITS, IMPORT_ROOMS } from "@/contracts/email-import";
import { parseNumber, safeText } from "./text";

/**
 * Validation of the fields a person may edit on a draft before saving. Everything else on the
 * saved record comes from re-reading the email on the server, never from the form.
 */

export const MESSAGE_ID_RE = /^[0-9a-f]{8,32}$/i;

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const isoDay = z.iso.date().refine((d) => d >= "2000-01-01" && d <= "2100-12-31");

const optDate = z.preprocess(blankToNull, isoDay.nullable());
const optReading = z.preprocess(
  blankToNull,
  z.string().max(16).nullable().transform((v, ctx) => {
    if (v === null) return null;
    const n = parseNumber(v, IMPORT_LIMITS.readingMax);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "reading" });
      return z.NEVER;
    }
    return n;
  }),
);

export const ApplianceEditSchema = z.object({
  messageId: z.string().regex(MESSAGE_ID_RE),
  model: z.preprocess(
    blankToNull,
    z.string().trim().max(IMPORT_LIMITS.model).regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/).transform((s) => s.toUpperCase()).nullable(),
  ),
  productName: z.preprocess(
    blankToNull,
    z.string().max(IMPORT_LIMITS.productName * 2).transform((s) => safeText(s, IMPORT_LIMITS.productName)).nullable(),
  ),
  purchaseDate: optDate,
  warrantyEnd: optDate,
  room: z.preprocess(blankToNull, z.enum(IMPORT_ROOMS).nullable()),
});
export type ApplianceEdit = z.infer<typeof ApplianceEditSchema>;

export const ReadingEditSchema = z.object({
  messageId: z.string().regex(MESSAGE_ID_RE),
  readingDate: optDate,
  elecSingle: optReading,
  elecDay: optReading,
  elecNight: optReading,
  gas: optReading,
  gasUnit: z.preprocess(blankToNull, z.enum(["m3", "ft3"]).nullable()),
});
export type ReadingEdit = z.infer<typeof ReadingEditSchema>;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
};

/** Only the listed editable keys are read from the form; anything else posted is ignored. */
export function parseApplianceForm(fd: FormData): ApplianceEdit | null {
  const r = ApplianceEditSchema.safeParse({
    messageId: str(fd, "messageId"),
    model: str(fd, "model"),
    productName: str(fd, "productName"),
    purchaseDate: str(fd, "purchaseDate"),
    warrantyEnd: str(fd, "warrantyEnd"),
    room: str(fd, "room"),
  });
  return r.success ? r.data : null;
}

export function parseReadingForm(fd: FormData): ReadingEdit | null {
  const r = ReadingEditSchema.safeParse({
    messageId: str(fd, "messageId"),
    readingDate: str(fd, "readingDate"),
    elecSingle: str(fd, "elecSingle"),
    elecDay: str(fd, "elecDay"),
    elecNight: str(fd, "elecNight"),
    gas: str(fd, "gas"),
    gasUnit: str(fd, "gasUnit"),
  });
  return r.success ? r.data : null;
}
