import { z } from "zod";
import { AMBER_DAYS } from "@/components/status";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, type DocumentCategory } from "./categories";

export { CATEGORY_LABEL, DOCUMENT_CATEGORIES, type DocumentCategory };
export const DocumentCategorySchema = z.enum(DOCUMENT_CATEGORIES);

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** The "expiring soon" window, from the shared traffic-light rule (30 days for documents). */
export const EXPIRY_WARNING_DAYS = AMBER_DAYS.document;

/** What the UI may see. The storage path is deliberately absent: it never reaches HTML. */
export const DocumentSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  title: z.string().min(1).max(200),
  category: DocumentCategorySchema,
  mime_type: z.string(),
  size_bytes: z.number().int().positive(),
  issued_on: z.iso.date().nullable(),
  expires_on: z.iso.date().nullable(),
  renewal_date: z.iso.date().nullable(),
  record_id: z.uuid().nullable(),
  notes: z.string().max(1000).nullable(),
  created_at: z.string(),
});
export type VaultDocument = z.infer<typeof DocumentSchema>;

export type RecordOption = { id: string; title: string };
