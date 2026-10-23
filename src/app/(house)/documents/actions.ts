"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { MSG, deleteDocument, parseDocumentId, uploadDocument, type Result } from "@/server/data/documents";
import type { FormState } from "@/components/tasks/types";

function finish(r: Result): FormState {
  if (!r.ok) return { error: r.error };
  revalidatePath("/documents");
  revalidatePath("/");
  return { ok: true };
}

export async function uploadDocumentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  return finish(await uploadDocument(s, fd));
}

export async function deleteDocumentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const id = parseDocumentId(fd.get("id"));
  if (!id) return { error: MSG.invalid };
  return finish(await deleteDocument(s, id));
}
