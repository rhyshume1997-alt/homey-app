"use client";

import { useActionState, useState } from "react";
import { IMPORT_LIMITS, IMPORT_ROOMS, type ApplianceDraft } from "@/contracts/email-import";
import type { DatePrefs } from "@/components/dates";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { Hint, SourceCard, type ImportAction } from "./shared";

const NOT_FOUND = "Not found in the email.";

function warrantyHint(d: ApplianceDraft): string {
  if (d.fields.warrantyComputed && d.fields.warrantyYears) {
    return `Worked out from '${d.fields.warrantyYears} year guarantee' and the purchase date. Please check.`;
  }
  if (d.found.warrantyEnd) return "From the email. Please check.";
  if (d.found.warrantyYears) return `The email mentions a ${d.fields.warrantyYears} year guarantee but no purchase date.`;
  return NOT_FOUND;
}

function ApplianceDraftCard({
  draft, index, total, action, prefs, onDone,
}: {
  draft: ApplianceDraft; index: number; total: number; action: ImportAction; prefs?: DatePrefs; onDone: (id: string, saved: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(async (prev: Parameters<ImportAction>[0], fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok) onDone(draft.messageId, true);
    return r;
  }, null);
  const f = draft.fields;
  return (
    <article aria-label={`Draft ${index} of ${total}`} className="flex flex-col gap-3">
      <SourceCard source={draft.source} index={index} total={total} prefs={prefs} />
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="messageId" value={draft.messageId} />
        <label className={LABEL}>
          Make
          <input value={f.make} readOnly aria-readonly className={FIELD} />
        </label>
        <label className={LABEL}>
          Model
          <input name="model" maxLength={IMPORT_LIMITS.model} defaultValue={f.model ?? ""} className={FIELD} />
          {draft.modelOptions.length > 0 ? (
            <Hint>Several models in the email: {draft.modelOptions.join(", ")}. Enter the right one.</Hint>
          ) : !draft.found.model ? <Hint>{NOT_FOUND}</Hint> : null}
        </label>
        <label className={LABEL}>
          Product
          <input name="productName" maxLength={IMPORT_LIMITS.productName} defaultValue={f.productName ?? ""} className={FIELD} />
          {!draft.found.productName && <Hint>{NOT_FOUND}</Hint>}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            Purchase date
            <input type="date" name="purchaseDate" defaultValue={f.purchaseDate ?? ""} className={FIELD} />
            {!draft.found.purchaseDate && <Hint>{NOT_FOUND}</Hint>}
          </label>
          <label className={LABEL}>
            Room
            <select name="room" defaultValue="" className={FIELD}>
              <option value="">Not set</option>
              {IMPORT_ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <label className={LABEL}>
          Warranty end
          <input type="date" name="warrantyEnd" defaultValue={f.warrantyEnd ?? ""} className={FIELD} />
          <Hint>{warrantyHint(draft)}</Hint>
        </label>
        {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={BTN_SECONDARY} onClick={() => onDone(draft.messageId, false)}>
            Discard
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving..." : "Save appliance"}
          </button>
        </div>
      </form>
    </article>
  );
}

/**
 * Review list for appliance drafts. Discard only hides a draft for this visit (nothing is stored);
 * Save sends the message id and the editable fields, and the server re-reads the email.
 */
export function ApplianceImportReview({ drafts, action, prefs }: { drafts: ApplianceDraft[]; action: ImportAction; prefs?: DatePrefs }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const onDone = (id: string, saved: boolean) => {
    setHidden((h) => new Set(h).add(id));
    if (saved) setSavedCount((n) => n + 1);
  };
  const visible = drafts.filter((d) => !hidden.has(d.messageId));
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-accent bg-surface p-3 text-sm">
        Draft from the email. Check and edit before saving.
        <span className="block text-muted">Read-only Gmail access. Nothing is saved yet.</span>
      </p>
      {savedCount > 0 && <p role="status" className="text-sm text-muted">Saved {savedCount} {savedCount === 1 ? "appliance" : "appliances"}.</p>}
      {visible.length === 0 ? (
        <p className="text-sm text-muted">No appliance emails to review.</p>
      ) : (
        visible.map((d, i) => (
          <ApplianceDraftCard key={d.messageId} draft={d} index={i + 1} total={visible.length} action={action} prefs={prefs} onDone={onDone} />
        ))
      )}
    </div>
  );
}
