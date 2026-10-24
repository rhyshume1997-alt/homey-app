"use client";
import { useState } from "react";
import { formatGBP } from "@/components/money/format";
import type { CostsSheet, Flag, FlagColumn, SummaryLine } from "@/server/integrations/sheets/costs";

export const READ_ONLY_BANNER =
  "Read-only copy of your Google Sheet. Edit the sheet in Google Sheets; nothing here changes it or moves money.";

const money = (n: number | null) => (n === null ? "blank" : formatGBP(n));

function Cell({ value, formula, flagged, showFormulas }: { value: number | null; formula?: string; flagged: boolean; showFormulas: boolean }) {
  return (
    <td className={`px-2 py-2 text-right align-top tabular-nums ${flagged ? "bg-amber-100 text-amber-950" : ""}`}>
      {flagged ? <span aria-label="Does not reconcile" title="Does not reconcile" data-testid="flag-marker">⚠ </span> : null}
      <span className={value === null ? "text-muted" : ""}>{money(value)}</span>
      {showFormulas && formula ? <code className="block break-all text-xs text-muted" data-testid="formula">{formula}</code> : null}
    </td>
  );
}

export type BudgetSource = { live: boolean; at: string; by?: string | null };

export function sourceLabel(src: BudgetSource): string {
  return src.live
    ? "Live from Google Sheets"
    : `Snapshot from ${src.at} (refreshed when ${src.by ?? "someone who is connected"} opens this page)`;
}

export function BudgetView({ sheet, flags, source }: { sheet: CostsSheet; flags: Flag[]; source?: BudgetSource }) {
  const [showFormulas, setShowFormulas] = useState(false);
  const flagged = (row: number, col: FlagColumn) => flags.some((f) => f.row === row && f.column === col);
  const anyFormula = [...sheet.bills, ...Object.values(sheet.summary).filter((x): x is SummaryLine => !!x)].some((l) => Object.keys(l.formulas).length > 0);

  const cells = (l: SummaryLine) => [
    <Cell key="amount" value={l.amount} formula={l.formulas.amount} flagged={flagged(l.row, "Amount")} showFormulas={showFormulas} />,
    ...sheet.shareLabels.map((label, k) => (
      <Cell key={k} value={l.shares[k] ?? null} formula={l.formulas.shares?.[k]} flagged={flagged(l.row, label)} showFormulas={showFormulas} />
    )),
  ];

  const line = (label: string, l: SummaryLine | null, key: string) =>
    l ? (
      <tr key={key} className="border-t border-border bg-surface-muted font-semibold" data-testid="summary-row">
        <th scope="row" className="px-2 py-2 text-left align-top">{label}</th>
        {cells(l)}
        <td />
      </tr>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p role="note" className="rounded-md border border-border bg-surface-muted p-3 text-sm">{READ_ONLY_BANNER}</p>

      {source ? (
        <p data-testid="source" className="text-sm text-muted">
          {sourceLabel(source)}
          {source.live ? null : (
            <>
              {" "}
              <a href="/settings/google" className="font-medium underline">Connect Google</a>
            </>
          )}
        </p>
      ) : null}

      <section aria-label="Monthly costs" className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Monthly costs</h2>
          <button
            type="button"
            aria-pressed={showFormulas}
            onClick={() => setShowFormulas((v) => !v)}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Formulas
          </button>
        </div>
        {showFormulas && !anyFormula ? (
          <p className="mt-2 text-sm text-muted">No formulas were returned for this sheet; the cells hold typed numbers.</p>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="px-2 py-2">Bill</th>
                <th scope="col" className="px-2 py-2 text-right">Amount</th>
                {sheet.shareLabels.map((label, k) => (
                  <th key={k} scope="col" className="px-2 py-2 text-right">{label}</th>
                ))}
                <th scope="col" className="px-2 py-2">Changes?</th>
              </tr>
            </thead>
            <tbody>
              {sheet.bills.map((b) => (
                <tr key={b.row} className="border-t border-border" data-testid="bill-row">
                  <th scope="row" className="px-2 py-2 text-left align-top font-medium">{b.name}</th>
                  {cells(b)}
                  <td className="px-2 py-2 align-top text-muted">{b.note ?? ""}</td>
                </tr>
              ))}
              {line("Total", sheet.summary.total, "t")}
              {line("Total PCM", sheet.summary.totalPcm, "p")}
              {line("Joint Account Total", sheet.summary.jointAccountTotal, "j")}
            </tbody>
          </table>
        </div>
        {sheet.payIntoLabel ? <p className="mt-2 text-sm text-muted">Sheet label: {sheet.payIntoLabel}</p> : null}
      </section>

      {flags.length > 0 ? (
        <section aria-label="Does not reconcile" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950">
          <h2 className="text-base font-semibold">Does not reconcile</h2>
          <p className="mt-1 text-sm">
            These are possible problems, not corrections. Nothing has been changed; check the sheet yourselves.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {flags.map((f, i) => (
              <li key={i} data-testid="flag" className="rounded-md bg-white/70 px-3 py-2 text-sm">
                <strong>Row {f.row}, {f.column}</strong>
                <div>{f.explanation}</div>
                <div className="tabular-nums">
                  Expected {f.expected === null ? "n/a" : formatGBP(f.expected)}, actual {f.actual === null ? "blank" : formatGBP(f.actual)}
                  {f.difference === null ? "" : `, difference ${formatGBP(f.difference)}`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted">No reconciliation problems found in the visible figures.</p>
      )}
    </div>
  );
}
