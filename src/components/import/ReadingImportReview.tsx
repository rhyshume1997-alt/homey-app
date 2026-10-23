"use client";

import { useActionState, useState } from "react";
import type { ElectricityRegister, MeterType, ReadingDraft } from "@/contracts/email-import";
import type { DatePrefs } from "@/components/dates";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { Hint, SourceCard, type ImportAction } from "./shared";

const FROM_EMAIL = "Extracted from the email body.";
const NOT_FOUND = "Not found in the email.";
const METER_LABEL: Record<MeterType, string> = {
  smart: "Smart meter", standard: "Standard meter", economy7: "Economy 7", prepayment: "Prepayment meter",
};
const REG: { key: ElectricityRegister; name: string; label: string }[] = [
  { key: "single", name: "elecSingle", label: "Electricity (kWh)" },
  { key: "day", name: "elecDay", label: "Electricity day (kWh)" },
  { key: "night", name: "elecNight", label: "Electricity night (kWh)" },
];

function ReadingDraftCard({
  draft, index, total, action, prefs, onDone,
}: {
  draft: ReadingDraft; index: number; total: number; action: ImportAction; prefs?: DatePrefs; onDone: (id: string, saved: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(async (prev: Parameters<ImportAction>[0], fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok) onDone(draft.messageId, true);
    return r;
  }, null);
  const f = draft.fields;
  const value = (k: ElectricityRegister) => f.electricity.find((e) => e.register === k)?.kwh;
  // Show the registers the email has; a single field when it has none (gas-only emails).
  const regs = REG.filter((r) => value(r.key) !== undefined);
  const shown = regs.length > 0 ? regs : REG.slice(0, 1);
  return (
    <article aria-label={`Draft ${index} of ${total}`} className="flex flex-col gap-3">
      <SourceCard source={draft.source} index={index} total={total} prefs={prefs} />
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="messageId" value={draft.messageId} />
        <label className={LABEL}>
          Reading date
          <input type="date" name="readingDate" defaultValue={f.readingDate ?? ""} className={FIELD} />
          {!draft.found.readingDate && <Hint>{NOT_FOUND} Add the date the meter was read.</Hint>}
        </label>
        {shown.map((r) => (
          <label key={r.key} className={LABEL}>
            {r.label}
            <input name={r.name} inputMode="decimal" maxLength={12} defaultValue={value(r.key) ?? ""} className={FIELD} />
            <Hint>{value(r.key) !== undefined ? FROM_EMAIL : NOT_FOUND}</Hint>
          </label>
        ))}
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <label className={LABEL}>
            Gas
            <input name="gas" inputMode="decimal" maxLength={12} defaultValue={f.gas?.value ?? ""} className={FIELD} />
            <Hint>{f.gas ? FROM_EMAIL : NOT_FOUND}</Hint>
          </label>
          <label className={LABEL}>
            Gas unit
            <select name="gasUnit" defaultValue={f.gas?.unit ?? ""} className={FIELD}>
              <option value="">Choose</option>
              <option value="m3">m³</option>
              <option value="ft3">ft³</option>
            </select>
            {f.gas && !draft.found.gasUnit && <Hint>Unit not stated in the email.</Hint>}
          </label>
        </div>
        {f.meterType && <p className="text-sm text-muted">Meter: {METER_LABEL[f.meterType]}</p>}
        {draft.found.estimatedSkipped && <p className="text-sm text-muted">Estimated readings in the email were left out.</p>}
        {draft.found.ambiguous && <p className="text-sm text-muted">The email had conflicting values, so some fields are empty.</p>}
        {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={BTN_SECONDARY} onClick={() => onDone(draft.messageId, false)}>
            Discard
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving..." : "Save readings"}
          </button>
        </div>
      </form>
    </article>
  );
}

/** Review list for meter reading drafts. Only confirmed readings are saved (and charted). */
export function ReadingImportReview({ drafts, action, prefs }: { drafts: ReadingDraft[]; action: ImportAction; prefs?: DatePrefs }) {
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
        Draft readings from the email. Nothing is saved until you confirm. Only confirmed readings are charted.
      </p>
      {savedCount > 0 && <p role="status" className="text-sm text-muted">Saved {savedCount} {savedCount === 1 ? "reading" : "readings"}.</p>}
      {visible.length === 0 ? (
        <p className="text-sm text-muted">No meter reading emails to review.</p>
      ) : (
        visible.map((d, i) => (
          <ReadingDraftCard key={d.messageId} draft={d} index={i + 1} total={visible.length} action={action} prefs={prefs} onDone={onDone} />
        ))
      )}
    </div>
  );
}
