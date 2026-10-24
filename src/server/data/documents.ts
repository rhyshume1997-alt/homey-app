import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createUserClient } from "@/server/db/supabase";
import { scopedDb } from "@/server/db/scoped";
import type { HouseholdSession } from "@/server/auth/session";
import { DocumentCategorySchema, DocumentSchema, type RecordOption, type VaultDocument } from "@/components/documents/types";
import { expiringSoon, sanitiseFilename, validSize, verifyMime } from "@/components/documents/files";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  badFile: "Choose a PDF, PNG, JPEG, WebP or HEIC file up to 20 MB.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load documents right now.",
} as const;

const BUCKET = "documents";
export const SIGNED_URL_SECONDS = 60;
const COLUMNS =
  "id, household_id, title, category, mime_type, size_bytes, issued_on, expires_on, renewal_date, record_id, notes, created_at";

const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

const MetaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: DocumentCategorySchema,
  issued_on: z.iso.date().nullable(),
  expires_on: z.iso.date().nullable(),
  renewal_date: z.iso.date().nullable(),
  record_id: z.uuid().nullable(),
  notes: z.string().max(1000).nullable(),
});
export type DocumentMeta = z.infer<typeof MetaSchema>;

export function parseDocumentMeta(fd: FormData): DocumentMeta | null {
  const r = MetaSchema.safeParse({
    title: fd.get("title") ?? "",
    category: fd.get("category"),
    issued_on: blank(fd.get("issued_on")),
    expires_on: blank(fd.get("expires_on")),
    renewal_date: blank(fd.get("renewal_date")),
    record_id: blank(fd.get("record_id")),
    notes: blank(fd.get("notes")),
  });
  return r.success ? r.data : null;
}

export function parseDocumentId(v: unknown): string | null {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
}

export async function listDocuments(): Promise<Result<VaultDocument[]>> {
  const sc = await scopedDb();
  if (!sc) return { ok: false, error: MSG.load };
  const { db, householdId } = sc;
  const { data, error } = await db.from("documents").select(COLUMNS).eq("household_id", householdId).order("created_at", { ascending: false }).limit(1000);
  if (error || !data) return { ok: false, error: MSG.load };
  const parsed = z.array(DocumentSchema).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: MSG.load };
}

export async function listRecordOptions(): Promise<RecordOption[]> {
  const sc = await scopedDb();
  if (!sc) return [];
  const { db, householdId } = sc;
  const { data } = await db.from("household_records").select("id, title").eq("household_id", householdId).order("title").limit(2000);
  const parsed = z.array(z.object({ id: z.uuid(), title: z.string() })).safeParse(data ?? []);
  return parsed.success ? parsed.data : [];
}

/** Validates the file, uploads it, then inserts the row. A failed insert removes the object. */
export async function uploadDocument(s: HouseholdSession, fd: FormData): Promise<Result> {
  const meta = parseDocumentMeta(fd);
  if (!meta) return { ok: false, error: MSG.invalid };
  const file = fd.get("file");
  if (!(file instanceof File) || !validSize(file.size)) return { ok: false, error: MSG.badFile };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validSize(bytes.length)) return { ok: false, error: MSG.badFile };
  const mime = verifyMime(file.type, bytes);
  if (!mime) return { ok: false, error: MSG.badFile };

  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };

  const id = randomUUID();
  const path = `${s.householdId}/${id}/${sanitiseFilename(file.name)}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { ok: false, error: MSG.failed };

  const ins = await db.from("documents").insert({
    id,
    household_id: s.householdId,
    ...meta,
    storage_path: path,
    mime_type: mime,
    size_bytes: bytes.length,
  });
  if (ins.error) {
    await db.storage.from(BUCKET).remove([path]);
    return { ok: false, error: MSG.failed };
  }
  return { ok: true, data: undefined };
}

/** Deletes the row (under RLS), then its object. */
export async function deleteDocument(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data, error } = await db
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("household_id", s.householdId)
    .select("storage_path")
    .maybeSingle();
  if (error || !data) return { ok: false, error: MSG.failed };
  await db.storage.from(BUCKET).remove([data.storage_path]);
  return { ok: true, data: undefined };
}

/**
 * A 60 second signed URL, only after re-checking the row exists in the caller's household.
 * Null when the document is not visible to the caller.
 */
export async function createDocumentUrl(s: HouseholdSession, id: string): Promise<string | null> {
  const db = await createUserClient();
  if (!db) return null;
  const { data: row } = await db
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .eq("household_id", s.householdId)
    .maybeSingle();
  if (!row || !row.storage_path.startsWith(`${s.householdId}/`)) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  return error || !data ? null : data.signedUrl;
}

/** Card data: total count and documents expired or expiring soon (the shared 30-day document rule). */
export async function documentsSummary(): Promise<{ count: number; expiring: VaultDocument[] } | null> {
  const r = await listDocuments();
  if (!r.ok) return null;
  return { count: r.data.length, expiring: expiringSoon(r.data) };
}
