import type { Cell } from "./google";

/** `shares` maps share column position (0-based, same order as CostsSheet.shareLabels) to a formula. */
export interface Formulas { amount?: string; shares?: Record<number, string> }
/** `shares[i]` is the figure in the i-th member share column (labelled by CostsSheet.shareLabels[i]). */
export interface SummaryLine { row: number; amount: number | null; shares: (number | null)[]; formulas: Formulas }
export interface Bill extends SummaryLine { name: string; note: string | null }
export interface CostsSummary { total: SummaryLine | null; totalPcm: SummaryLine | null; jointAccountTotal: SummaryLine | null }
export interface CostsSheet { bills: Bill[]; summary: CostsSummary; shareLabels: string[]; payIntoLabel: string | null; lastRow: number }

/** "Amount" or one of the sheet's own share column headers. */
export type FlagColumn = string;
export interface Flag {
  row: number; // 1-based sheet row
  column: FlagColumn;
  expected: number | null;
  actual: number | null;
  difference: number | null;
  explanation: string;
}

const gbp = (n: number) => `£${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;
const cents = (n: number) => Math.round(n * 100);

export function toNumber(c: Cell | undefined): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  const s = c.replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const text = (c: Cell | undefined): string | null => {
  if (typeof c !== "string") return null;
  const t = c.trim();
  return t === "" ? null : t;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const formulaOf = (c: Cell | undefined): string | undefined => (typeof c === "string" && c.trim().startsWith("=") ? c.trim() : undefined);

type SummaryKey = keyof CostsSummary;
function summaryKey(name: string): SummaryKey | null {
  const n = norm(name);
  if (n.startsWith("joint")) return "jointAccountTotal";
  if (/^total (pcm|per calendar month|monthly|per month)/.test(n)) return "totalPcm";
  if (n === "total" || n === "totals") return "total";
  return null;
}

export function parseCosts(values: Cell[][], formulaGrid: Cell[][] = []): CostsSheet {
  let h = values.findIndex((r) => /bill/i.test(text(r?.[0]) ?? ""));
  if (h < 0) h = 0;
  const header = values[h] ?? [];
  const find = (re: RegExp, fallback: number) => {
    const i = header.findIndex((c) => re.test(text(c) ?? ""));
    return i >= 0 ? i : fallback;
  };
  const cA = find(/^amount/i, 1);
  const notesAt = header.findIndex((c, i) => i > cA && /change|note/i.test(text(c) ?? ""));
  let end = notesAt;
  if (end < 0) {
    end = header.findIndex((c, i) => i > cA && (text(c) === null || /joint|pay/i.test(text(c) ?? "")));
    if (end < 0) end = header.length;
  }
  const shareCols: { label: string; idx: number }[] = [];
  for (let i = cA + 1; i < end; i++) {
    const label = text(header[i]);
    if (label) shareCols.push({ label, idx: i });
  }
  if (shareCols.length === 0) shareCols.push({ label: "Share", idx: cA + 1 });
  const cN = notesAt >= 0 ? notesAt : Math.max(end, shareCols[shareCols.length - 1]!.idx + 1);
  const payInto = header.map((c) => text(c)).find((t) => t && /joint|pay/i.test(t)) ?? null;

  const bills: Bill[] = [];
  const summary: CostsSummary = { total: null, totalPcm: null, jointAccountTotal: null };
  let lastRow = h + 1;
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const name = text(r[0]);
    if (!name) continue;
    const f = formulaGrid[i] ?? [];
    const formulas: Formulas = {};
    const fa = formulaOf(f[cA]);
    if (fa) formulas.amount = fa;
    shareCols.forEach((c, k) => {
      const fs = formulaOf(f[c.idx]);
      if (fs) (formulas.shares ??= {})[k] = fs;
    });
    const line: SummaryLine = { row: i + 1, amount: toNumber(r[cA]), shares: shareCols.map((c) => toNumber(r[c.idx])), formulas };
    lastRow = i + 1;
    const key = summaryKey(name);
    if (key) {
      summary[key] ??= line;
    } else {
      const raw = r[cN];
      const note = typeof raw === "string" ? text(raw) : typeof raw === "number" ? String(raw) : null;
      bills.push({ name, note, ...line });
    }
  }
  return { bills, summary, shareLabels: shareCols.map((c) => c.label), payIntoLabel: payInto, lastRow };
}

const diff = (expected: number | null, actual: number | null) =>
  expected === null || actual === null ? null : Math.round((actual - expected) * 100) / 100;
const flag = (row: number, column: FlagColumn, expected: number | null, actual: number | null, explanation: string): Flag => ({
  row, column, expected, actual, difference: diff(expected, actual), explanation,
});

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const allPresent = (xs: (number | null)[]): xs is number[] => xs.length > 0 && xs.every((x) => x !== null);
const shareSum = (l: SummaryLine) => sum(l.shares);
const sharesText = (l: SummaryLine, labels: string[]) =>
  `${labels.map((lab, k) => `${lab} ${gbp(l.shares[k] ?? 0)}`).join(" + ")} = ${gbp(shareSum(l))}`;

/** Lists problems with reasons. Never changes or "fixes" any figure. */
export function reconcile(sheet: CostsSheet): Flag[] {
  const flags: Flag[] = [];
  const { bills, summary, shareLabels: labels } = sheet;
  const cols = labels.map((label, k) => ({ label, k }));
  // The Amount column is checked like a share column (k = -1) for the Total and Total PCM rows.
  const val = (l: { amount: number | null; shares: (number | null)[] }, k: number) => (k < 0 ? l.amount : l.shares[k] ?? null);
  const withAmount = [{ label: "Amount", k: -1 }, ...cols];

  for (const b of bills) {
    if (b.amount === null && b.shares.some((x) => x !== null)) {
      const shares = shareSum(b);
      flags.push(flag(b.row, "Amount", shares, null,
        `${b.name}: Amount is blank but shares are present (${b.shares.map((x) => gbp(x ?? 0)).join(" + ")} = ${gbp(shares)}). The Total row may be missing this bill.`));
    } else if (b.amount !== null && allPresent(b.shares) && cents(b.amount) !== cents(shareSum(b))) {
      const shares = shareSum(b);
      let why = `${b.name}: Amount ${gbp(b.amount)} but ${sharesText(b, labels)}.`;
      if (shares > 0 && b.amount / shares >= 2) {
        why += ` This could be an annual or multi-month figure set against monthly shares (${gbp(b.amount)} / 12 = ${gbp(b.amount / 12)}), or a typing slip; the sheet does not say which.`;
      } else {
        why += " One of these figures may be mistyped or out of date; the sheet does not say which.";
      }
      flags.push(flag(b.row, "Amount", shares, b.amount, why));
    }
  }

  const { total, totalPcm, jointAccountTotal } = summary;
  if (total) {
    for (const { label, k } of withAmount) {
      const parts = bills.filter((b) => val(b, k) !== null);
      const expected = sum(parts.map((b) => val(b, k)));
      const actual = val(total, k);
      if (actual !== null && cents(expected) !== cents(actual)) {
        const missing = bills.filter((b) => val(b, k) === null).map((b) => b.name);
        flags.push(flag(total.row, label, expected, actual,
          `Total ${label}: the ${parts.length} listed bills add up to ${gbp(expected)} but the Total row shows ${gbp(actual)}.` +
          (missing.length ? ` Blank in this column: ${missing.join(", ")}.` : "")));
      }
    }
    if (total.amount !== null && allPresent(total.shares) && cents(total.amount) !== cents(shareSum(total))) {
      flags.push(flag(total.row, "Amount", shareSum(total), total.amount,
        `Total row: Amount ${gbp(total.amount)} but ${sharesText(total, labels)}.`));
    }
  }

  if (totalPcm) {
    for (const { label, k } of withAmount) {
      const actual = val(totalPcm, k);
      if (actual === null) continue;
      const bySum = sum(bills.map((b) => val(b, k)));
      const byTotal = total ? val(total, k) : null;
      if (cents(actual) === cents(bySum) || (byTotal !== null && cents(actual) === cents(byTotal))) continue;
      flags.push(flag(totalPcm.row, label, byTotal ?? bySum, actual,
        `Total PCM ${label} is ${gbp(actual)}. Bills add up to ${gbp(bySum)}` +
        (byTotal !== null ? `; the Total row shows ${gbp(byTotal)}` : "") +
        `. Neither matches, so the basis for this figure cannot be worked out from the visible cells.`));
    }
    if (totalPcm.amount !== null && allPresent(totalPcm.shares) && cents(totalPcm.amount) !== cents(shareSum(totalPcm))) {
      flags.push(flag(totalPcm.row, "Amount", shareSum(totalPcm), totalPcm.amount,
        `Total PCM: Amount ${gbp(totalPcm.amount)} but ${sharesText(totalPcm, labels)}.`));
    }
  }

  if (jointAccountTotal) {
    for (const { label, k } of cols) {
      const actual = jointAccountTotal.shares[k] ?? null;
      if (actual === null) continue;
      const pcm = totalPcm?.shares[k] ?? null;
      const bySum = sum(bills.map((b) => b.shares[k] ?? null));
      if ((pcm !== null && cents(actual) === cents(pcm)) || (pcm === null && cents(actual) === cents(bySum))) continue;
      flags.push(flag(jointAccountTotal.row, label, pcm ?? bySum, actual,
        `Joint Account Total ${label} is ${gbp(actual)}` +
        (pcm !== null ? `, but Total PCM ${label} is ${gbp(pcm)} (difference ${gbp(actual - pcm)}).` : `, but bills add up to ${gbp(bySum)}.`) +
        ` For reference, bills in this column add up to ${gbp(bySum)}.`));
    }
  }

  flags.push(...formulaFlags(sheet));
  return flags.sort((a, b) => a.row - b.row);
}

function colNum(s: string): number {
  return [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
function outsideTable(formula: string, lastRow: number, lastCol: number): string | null {
  if (formula.includes("!")) return "refers to another sheet";
  for (const r of formula.match(/\$?[A-Z]{1,3}\$?\d+/g) ?? []) {
    const m = /\$?([A-Z]{1,3})\$?(\d+)/.exec(r)!;
    if (colNum(m[1]!) > lastCol || Number(m[2]) > lastRow) return `refers to ${r.replace(/\$/g, "")}, outside the table (A1:${String.fromCharCode(64 + Math.min(lastCol, 26))}${lastRow})`;
  }
  return null;
}

function formulaFlags(sheet: CostsSheet): Flag[] {
  const flags: Flag[] = [];
  const names = { total: "Total", totalPcm: "Total PCM", jointAccountTotal: "Joint Account Total" } as const;
  const lines: { name: string; line: SummaryLine }[] = [
    ...sheet.bills.map((b) => ({ name: b.name, line: b as SummaryLine })),
    ...(Object.keys(names) as SummaryKey[]).flatMap((k) => (sheet.summary[k] ? [{ name: names[k], line: sheet.summary[k]! }] : [])),
  ].sort((a, b) => a.line.row - b.line.row);

  lines.forEach(({ name, line }, i) => {
    const columns: { label: string; f: string | undefined; v: number | null }[] = [
      { label: "Amount", f: line.formulas.amount, v: line.amount },
      ...sheet.shareLabels.map((label, k) => ({ label, f: line.formulas.shares?.[k], v: line.shares[k] ?? null })),
    ];
    columns.forEach((col, ci) => {
      const { label, f, v } = col;
      if (f) {
        const why = outsideTable(f, sheet.lastRow, sheet.shareLabels.length + 3);
        if (why) flags.push(flag(line.row, label, null, v, `${name} ${label} formula ${f} ${why}.`));
        return;
      }
      if (v === null) return;
      const nb = [lines[i - 1], lines[i + 1]].filter((x): x is (typeof lines)[number] => !!x);
      const has = (l: SummaryLine) => (ci === 0 ? !!l.formulas.amount : !!l.formulas.shares?.[ci - 1]);
      if (nb.length > 0 && nb.every((n) => has(n.line))) {
        flags.push(flag(line.row, label, null, v,
          `${name} ${label} is a typed number (${gbp(v)}) while the rows above and below use formulas; it will not update with them.`));
      }
    });
  });
  return flags;
}
