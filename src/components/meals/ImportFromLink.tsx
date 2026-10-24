"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { FormAction } from "@/components/tasks/types";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { formatDate, type DatePrefs } from "@/components/dates";
import type { PreviewResult, RecipeSource } from "@/contracts/recipe-import";
import { IMPORT_LIMITS } from "@/contracts/recipe-import";
import { MEAL_LIMITS, MEAL_SLOTS, SLOT_LABEL, addDays, todayLondon, type Meal, type MealSlot } from "./types";

export type ImportActions = {
  preview: (url: string) => Promise<PreviewResult>;
  fromText: (text: string) => Promise<PreviewResult>;
  save: FormAction;
};

type Row = { k: number; on: boolean; name: string; quantity: string };
type Loaded = { title: string; source: RecipeSource; truncated: boolean; rows: Row[]; link: string | null };

const SOURCE_LABEL: Record<RecipeSource, string> = {
  website: "From the recipe page",
  tiktok: "From the TikTok caption",
  instagram: "From Instagram",
  text: "From the text you pasted",
};

/** The link without its query string or fragment, for the new meal's notes. */
function plainLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function Preview({
  loaded,
  meals,
  week,
  datePrefs,
  save,
  onSaved,
}: {
  loaded: Loaded;
  meals: Meal[];
  week: string;
  datePrefs?: DatePrefs;
  save: FormAction;
  onSaved: (msg: string) => void;
}) {
  const [rows, setRows] = useState(loaded.rows);
  const [mode, setMode] = useState<"existing" | "new">(meals.length ? "existing" : "new");
  const [mealId, setMealId] = useState(meals[0]?.id ?? "");
  const [state, formAction, pending] = useActionState(save, null);
  const today = todayLondon();
  const defaultDate = today >= week && today <= addDays(week, 6) ? today : week;
  const ticked = rows.filter((r) => r.on && r.name.trim()).length;
  const chosen = meals.find((m) => m.id === mealId);
  const patch = (k: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...p } : r)));
  const notes = loaded.link && `From ${loaded.link}`.length <= MEAL_LIMITS.notes ? `From ${loaded.link}` : "";

  const label = mode === "existing" && chosen ? `Add to ${chosen.title}` : "Add as new meal";

  useEffect(() => {
    if (state?.ok) onSaved(mode === "existing" && chosen ? `Added to ${chosen.title}.` : "Added as a new meal.");
    // Only react to a fresh result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label="Ingredients found">
      <p className="text-sm text-muted">
        {SOURCE_LABEL[loaded.source]}. Untick anything you don&apos;t need and fix any quantities. Nothing is saved until you add it.
      </p>
      {loaded.truncated && (
        <p className="text-sm text-muted">This recipe lists more than {MEAL_LIMITS.maxIngredients} ingredients; only the first {MEAL_LIMITS.maxIngredients} are shown.</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r, n) => (
          <li key={r.k} data-testid="import-row" className="flex items-start gap-2 rounded-md bg-surface-muted p-2">
            <input
              type="checkbox"
              checked={r.on}
              onChange={(e) => patch(r.k, { on: e.target.checked })}
              aria-label={`Include ${r.name || `ingredient ${n + 1}`}`}
              className="mt-1 h-11 w-11 shrink-0"
            />
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
              <label className={LABEL}>
                <span className="sr-only">Ingredient {n + 1}</span>
                <input
                  name="imp_name"
                  value={r.name}
                  disabled={!r.on}
                  maxLength={MEAL_LIMITS.name}
                  onChange={(e) => patch(r.k, { name: e.target.value })}
                  aria-label={`Ingredient ${n + 1} name`}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                <span className="sr-only">Quantity</span>
                <input
                  name="imp_quantity"
                  value={r.quantity}
                  disabled={!r.on}
                  maxLength={MEAL_LIMITS.quantity}
                  placeholder="Qty"
                  onChange={(e) => patch(r.k, { quantity: e.target.value })}
                  aria-label={`Quantity for ${r.name || `ingredient ${n + 1}`}`}
                  className={FIELD}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Where should these go?</legend>
        {meals.length > 0 && (
          <label className="flex min-h-[var(--touch-target)] items-center gap-2 text-base">
            <input type="radio" name="mode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} className="h-11 w-11" />
            A meal this week
          </label>
        )}
        <label className="flex min-h-[var(--touch-target)] items-center gap-2 text-base">
          <input type="radio" name="mode" value="new" checked={mode === "new"} onChange={() => setMode("new")} className="h-11 w-11" />
          A new meal
        </label>
      </fieldset>

      {mode === "existing" ? (
        <label className={LABEL}>
          Meal
          <select name="meal_id" value={mealId} onChange={(e) => setMealId(e.target.value)} className={FIELD}>
            {meals.map((m) => (
              <option key={m.id} value={m.id}>
                {formatDate(m.planned_on, datePrefs)} {SLOT_LABEL[m.slot]}: {m.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Date
              <input type="date" name="planned_on" required defaultValue={defaultDate} className={FIELD} />
            </label>
            <label className={LABEL}>
              Meal
              <select name="slot" defaultValue={"dinner" satisfies MealSlot} className={FIELD}>
                {MEAL_SLOTS.map((s) => (
                  <option key={s} value={s}>{SLOT_LABEL[s]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className={LABEL}>
            What is on the menu
            <input name="title" required maxLength={MEAL_LIMITS.title} defaultValue={loaded.title} className={FIELD} />
          </label>
          <label className={LABEL}>
            Notes (optional)
            <input name="notes" maxLength={MEAL_LIMITS.notes} defaultValue={notes} className={FIELD} />
          </label>
        </div>
      )}

      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      <button type="submit" disabled={pending || ticked === 0} className={`${BTN_PRIMARY} self-start`}>
        {label}
      </button>
    </form>
  );
}

/** "Add from a link": paste a recipe page, TikTok or Instagram link (or the text), tick, confirm. */
export function ImportFromLink({
  week,
  meals,
  actions,
  datePrefs,
}: {
  week: string;
  meals: Meal[];
  actions: ImportActions;
  datePrefs?: DatePrefs;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [done, setDone] = useState("");
  const [busy, start] = useTransition();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const reset = () => {
    setUrl("");
    setText("");
    setShowPaste(false);
    setError("");
    setLoaded(null);
  };
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const take = (r: PreviewResult, link: string | null) => {
    if (r.ok) {
      setError("");
      setVersion((v) => v + 1);
      setLoaded({
        title: r.preview.title,
        source: r.preview.source,
        truncated: !!r.preview.truncated,
        link,
        rows: r.preview.ingredients.map((i, k) => ({ k, on: true, name: i.name, quantity: i.quantity ?? "" })),
      });
    } else {
      setLoaded(null);
      setError(r.error);
      setShowPaste(true);
    }
  };

  const fetchLink = () =>
    start(async () => {
      try {
        take(await actions.preview(url.trim()), plainLink(url));
      } catch {
        take({ ok: false, error: "Couldn't load that link. You can paste the recipe text below instead." }, null);
      }
    });
  const readText = () =>
    start(async () => {
      try {
        take(await actions.fromText(text), plainLink(url));
      } catch {
        take({ ok: false, error: "Something went wrong. Please try again." }, null);
      }
    });

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          className={`${BTN_SECONDARY} self-start`}
          onClick={() => {
            reset();
            setDone("");
            setOpen(true);
          }}
        >
          Add from a link
        </button>
        <p role="status" aria-live="polite" className={done ? "text-sm font-medium" : "sr-only"}>{done}</p>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-4 shadow-xl sm:rounded-3xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-lg font-semibold">Add from a link</h2>
              <button type="button" onClick={close} className={BTN_SECONDARY}>Close</button>
            </div>

            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) fetchLink();
              }}
            >
              <label className={LABEL}>
                Recipe, TikTok or Instagram link
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={IMPORT_LIMITS.url}
                  placeholder="https://"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className={FIELD}
                />
              </label>
              <button type="submit" disabled={busy || !url.trim()} className={`${BTN_PRIMARY} self-start`}>
                {busy ? "Fetching…" : "Fetch"}
              </button>
            </form>

            {error && <p role="alert" className="mt-3 text-sm font-medium text-warning-fg">{error}</p>}

            {!showPaste && !loaded && (
              <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={() => setShowPaste(true)}>
                Paste the recipe text instead
              </button>
            )}
            {showPaste && (
              <div className="mt-3 flex flex-col gap-2">
                <label className={LABEL}>
                  Paste the caption or recipe text
                  <textarea
                    rows={6}
                    maxLength={IMPORT_LIMITS.text}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className={FIELD}
                  />
                </label>
                <button type="button" disabled={busy || !text.trim()} onClick={readText} className={`${BTN_SECONDARY} self-start`}>
                  Find ingredients
                </button>
              </div>
            )}

            {loaded && (
              <div className="mt-4">
                <Preview
                  key={version}
                  loaded={loaded}
                  meals={meals}
                  week={week}
                  datePrefs={datePrefs}
                  save={actions.save}
                  onSaved={(msg) => {
                    setDone(msg);
                    close();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
