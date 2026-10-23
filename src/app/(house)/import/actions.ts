"use server";

import type { ImportActionState } from "@/contracts/email-import";
import { requireSession } from "@/server/auth/session";
import { importSavers } from "@/server/integrations/gmail-import/savers";
import { saveApplianceFromEmail, saveReadingFromEmail } from "@/server/integrations/gmail-import/service";

/**
 * Save one draft after a person pressed Save. The session is validated here; the service re-reads
 * the email with the caller's own token and only takes the editable fields from the form.
 * No revalidation: the review list hides the saved draft itself, and re-rendering would read
 * Gmail again for nothing.
 */
export async function saveApplianceDraftAction(_prev: ImportActionState, fd: FormData): Promise<ImportActionState> {
  const s = await requireSession();
  return saveApplianceFromEmail(s, fd, { saver: importSavers().appliance });
}

export async function saveReadingDraftAction(_prev: ImportActionState, fd: FormData): Promise<ImportActionState> {
  const s = await requireSession();
  return saveReadingFromEmail(s, fd, { saver: importSavers().reading });
}
