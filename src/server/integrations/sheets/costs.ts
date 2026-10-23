import type { Cell } from "./google";

export interface Formulas { amount?: string; rhys?: string; rachel?: string }
export interface SummaryLine { row: number; amount: number | null; rhys: number | null; rachel: number | null; formulas: Formulas }
export interface Bill extends SummaryLine { name: string; note: string | null }
export interface CostsSummary { total: SummaryLine | null; totalPcm: SummaryLine | null; jointAccountTotal: SummaryLine | null }
export interface CostsSheet { bills: Bill[]; summary: CostsSummary; payIntoLabel: string | null; lastRow: number }

export type FlagColumn = "Amount" | "Rhys" | "Rachel";
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
  const cA = find(/^amount/i, 1), cRh = find(/rhys/i, 2), cRa = find(/rachel/i, 3), cN = find(/change|note/i, 4);
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
    const fa = formulaOf(f[cA]), fr = formulaOf(f[cRh]), fc = formulaOf(f[cRa]);
    if (fa) formulas.amount = fa;
    if (fr) formulas.rhys = fr;
    if (fc) formulas.rachel = fc;
    const line: SummaryLine = { row: i + 1, amount: toNumber(r[cA]), rhys: toNumber(r[cRh]), rachel: toNumber(r[cRa]), formulas };
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
  return { bills, summary, payIntoLabel: payInto, lastRow };
}

const diff = (expected: number | null, actual: number | null) =>
  expected === null || actual === null ? null : Math.round((actual - expected) * 100) / 100;
const flag = (row: number, column: FlagColumn, expected: number | null, actual: number | null, explanation: string): Flag => ({
  row, column, expected, actual, difference: diff(expected, actual), explanation,
});

const COLS = [["Amount", "amount"], ["Rhys", "rhys"], ["Rachel", "rachel"]] as const;
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Lists problems with reasons. Never changes or "fixes" any figure. */
export function reconcile(sheet: CostsSheet): Flag[] {
  const flags: Flag[] = [];
  const { bills, summary } = sheet;

  for (const b of bills) {
    if (b.amount === null && (b.rhys !== null || b.rachel !== null)) {
      const shares = (b.rhys ?? 0) + (b.rachel ?? 0);
      flags.push(flag(b.row, "Amount", shares, null,
        `${b.name}: Amount is blank but shares are present (${gbp(b.rhys ?? 0)} + ${gbp(b.rachel ?? 0)} = ${gbp(shares)}). The Total row may be missing this bill.`));
    } else if (b.amount !== null && b.rhys !== null && b.rachel !== null && cents(b.amount) !== cents(b.rhys + b.rachel)) {
      const shares = b.rhys + b.rachel;
      let why = `${b.name}: Amount ${gbp(b.amount)} but Rhys ${gbp(b.rhys)} + Rachel ${gbp(b.rachel)} = ${gbp(shares)}.`;
      if (shares > 0 && b.amount / shares >= 2) {
        why += ` This could be an annual or multi-month figure set against monthly shares (${gbp(b.amount)} / 12 = ${gbp(b.amount / 12)}), or a typing slip; the sheet does not say which.`;
      } else {
        why += " One of the three figures may be mistyped or out of date; the sheet does not say which.";
      }
      flags.push(flag(b.row, "Amount", shares, b.amount, why));
    }
  }

  const { total, totalPcm, jointAccountTotal } = summary;
  if (total) {
    for (const [label, k] of COLS) {
      const parts = bills.filter((b) => b[k] !== null);
      const expected = sum(parts.map((b) => b[k]));
      const actual = total[k];
      if (actual !== null && cents(expected) !== cents(actual)) {
        const missing = bills.filter((b) => b[k] === null).map((b) => b.name);
        flags.push(flag(total.row, label, expected, actual,
          `Total ${label}: the ${parts.length} listed bills add up to ${gbp(expected)} but the Total row shows ${gbp(actual)}.` +
          (missing.length ? ` Blank in this column: ${missing.join(", ")}.` : "")));
      }
    }
    if (total.amount !== null && total.rhys !== null && total.rachel !== null && cents(total.amount) !== cents(total.rhys + total.rachel)) {
      flags.push(flag(total.row, "Amount", total.rhys + total.rachel, total.amount,
        `Total row: Amount ${gbp(total.amount)} but Rhys ${gbp(total.rhys)} + Rachel ${gbp(total.rachel)} = ${gbp(total.rhys + total.rachel)}.`));
    }
  }

  if (totalPcm) {
    for (const [label, k] of COLS) {
      const actual = totalPcm[k];
      if (actual === null) continue;
      const bySum = sum(bills.map((b) => b[k]));
      const byTotal = total?.[k] ?? null;
      if (cents(actual) === cents(bySum) || (byTotal !== null && cents(actual) === cents(byTotal))) continue;
      flags.push(flag(totalPcm.row, label, byTotal ?? bySum, actual,
        `Total PCM ${label} is ${gbp(actual)}. Bills add up to ${gbp(bySum)}` +
        (byTotal !== null ? `; the Total row shows ${gbp(byTotal)}` : "") +
        `. Neither matches, so the basis for this figure cannot be worked out from the visible cells.`));
    }
    if (totalPcm.amount !== null && totalPcm.rhys !== null && totalPcm.rachel !== null && cents(totalPcm.amount) !== cents(totalPcm.rhys + totalPcm.rachel)) {
      const s = totalPcm.rhys + totalPcm.rachel;
      flags.push(flag(totalPcm.row, "Amount", s, totalPcm.amount,
        `Total PCM: Amount ${gbp(totalPcm.amount)} but Rhys ${gbp(totalPcm.rhys)} + Rachel ${gbp(totalPcm.rachel)} = ${gbp(s)}.`));
    }
  }

  if (jointAccountTotal) {
    for (const [label, k] of [["Rhys", "rhys"], ["Rachel", "rachel"]] as const) {
      const actual = jointAccountTotal[k];
      if (actual === null) continue;
      const pcm = totalPcm?.[k] ?? null;
      const bySum = sum(bills.map((b) => b[k]));
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
function outsideTable(formula: string, lastRow: number): string | null {
  if (formula.includes("!")) return "refers to another sheet";
  for (const r of formula.match(/\$?[A-Z]{1,3}\$?\d+/g) ?? []) {
    const m = /\$?([A-Z]{1,3})\$?(\d+)/.exec(r)!;
    if (colNum(m[1]!) > 5 || Number(m[2]) > lastRow) return `refers to ${r.replace(/\$/g, "")}, outside the table (A1:E${lastRow})`;
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
    for (const [label, k] of COLS) {
      const f = line.formulas[k];
      if (f) {
        const why = outsideTable(f, sheet.lastRow);
        if (why) flags.push(flag(line.row, label, null, line[k], `${name} ${label} formula ${f} ${why}.`));
        continue;
      }
      const v = line[k];
      if (v === null) continue;
      const nb = [lines[i - 1], lines[i + 1]].filter((x): x is (typeof lines)[number] => !!x);
      if (nb.length > 0 && nb.every((n) => n.line.formulas[k])) {
        flags.push(flag(line.row, label, null, v,
          `${name} ${label} is a typed number (${gbp(v)}) while the rows above and below use formulas; it will not update with them.`));
      }
    }
  });
  return flags;
}
