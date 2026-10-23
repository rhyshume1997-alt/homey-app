"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, FIELD, LABEL } from "@/components/tasks/styles";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES } from "./categories";
import type { RecordOption } from "./types";

export function DocumentForm({ action, records }: { action: FormAction; records: readonly RecordOption[] }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <label className={LABEL}>
        File (PDF, PNG, JPEG, WebP or HEIC, up to 20 MB)
        <input name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" className={FIELD} />
      </label>
      <label className={LABEL}>
        Title
        <input name="title" required maxLength={200} className={FIELD} />
      </label>
      <label className={LABEL}>
        Category
        <select name="category" defaultValue="other" className={FIELD}>
          {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>Issued on<input name="issued_on" type="date" className={FIELD} /></label>
        <label className={LABEL}>Expires on<input name="expires_on" type="date" className={FIELD} /></label>
        <label className={LABEL}>Renewal date<input name="renewal_date" type="date" className={FIELD} /></label>
      </div>
      <label className={LABEL}>
        Linked record (optional)
        <select name="record_id" defaultValue="" className={FIELD}>
          <option value="">None</option>
          {records.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </label>
      <label className={LABEL}>
        Notes
        <textarea name="notes" rows={2} maxLength={1000} className={FIELD} />
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Uploaded.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>
        {pending ? "Uploading..." : "Upload document"}
      </button>
    </form>
  );
}
