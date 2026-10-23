import "server-only";
import {
  IMPORT_LIMITS, type ElectricityReading, type ElectricityRegister, type EonEmailKind, type GasUnit, type MeterType,
  type ReadingFields, type ReadingFound,
} from "@/contracts/email-import";
import { DATE_SRC, NUMBER_SRC, distinct, parseDate, parseNumber } from "./text";

/**
 * Deterministic parser for E.ON reading confirmations and bills. Regex only, no LLM.
 * Only explicitly labelled readings are taken ("Electricity reading: 12345"). Previous/opening
 * readings and anything marked estimated are left out. Values are never interpolated or invented:
 * a register with conflicting values is left empty.
 */

export interface EonParse { kind: EonEmailKind; fields: ReadingFields; found: ReadingFound }

const SEP = "[\\s:|\\-–]{0,6}(?:(?:of|was|is|=)\\s+)?";
const NUM = `(${NUMBER_SRC})(?!\\d|[/.,\\-]\\d)`;

const ELEC_RE = new RegExp(
  `\\b(?:electricity|electric)(?:\\s+meter)?(?:\\s+\\(?(day|night)\\)?)?\\s+reading(?:\\s+\\(?(day|night)\\)?)?(?!\\s*dates?\\b)${SEP}${NUM}`,
  "gi",
);
const DAY_NIGHT_RE = new RegExp(`\\b(day|night)(?:\\s+(?:rate|register))?\\s+reading(?!\\s*dates?\\b)${SEP}${NUM}`, "gi");
const GAS_RE = new RegExp(
  `\\bgas(?:\\s+meter)?\\s+reading(?!\\s*dates?\\b)${SEP}${NUM}(?:\\s*(m3|m³|m\\^3|cubic\\s+met(?:re|er)s?|ft3|ft³|cubic\\s+feet|hundreds\\s+of\\s+cubic\\s+feet|hcf)(?![a-z0-9]))?`,
  "gi",
);
const DATE_LABEL =
  "reading\\s+date|date\\s+of\\s+(?:reading|read)|read\\s+date|date\\s+read|meter\\s+read\\s+date|readings?\\s+(?:taken|submitted|received|provided)(?:\\s+on)?|submitted\\s+on|taken\\s+on";
const DATE_RE = new RegExp(`\\b(?:${DATE_LABEL})${SEP}(${DATE_SRC})`, "gi");
const METER_TYPE_RE = /\bmeter\s+type\s*[:|\-]?\s*(smart|standard|credit|traditional|economy\s*7|e7|prepayment|prepay)\b/i;

function gasUnit(raw: string | undefined): GasUnit | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/ft|feet|hcf/.test(s)) return "ft3";
  return "m3";
}

function meterType(text: string): MeterType | null {
  const m = METER_TYPE_RE.exec(text)?.[1]?.toLowerCase().replace(/\s+/g, "");
  if (m) {
    if (m === "smart") return "smart";
    if (m === "economy7" || m === "e7") return "economy7";
    if (m === "prepayment" || m === "prepay") return "prepayment";
    return "standard";
  }
  if (/\breadings?\s+(?:were\s+)?(?:sent|received|taken)\s+(?:automatically\s+)?from\s+your\s+smart\s+meter\b/i.test(text)) return "smart";
  return null;
}

/** The line around a match, split at the match, for "previous" / "estimated" checks. */
function around(text: string, m: RegExpMatchArray): { before: string; after: string } {
  const start = m.index ?? 0;
  const end = start + m[0].length;
  const ls = text.lastIndexOf("\n", start) + 1;
  const le = text.indexOf("\n", end);
  return { before: text.slice(ls, start), after: text.slice(end, le < 0 ? text.length : le).slice(0, 40) };
}

const PREVIOUS = /\b(?:previous|prior|last|opening|old)\b/i;
const ESTIMATED = /\(e\)|\bestimat/i;

export function parseEonEmail(input: { subject: string; text: string; receivedAt: string }): EonParse | null {
  const { text, subject } = input;
  const received = input.receivedAt.slice(0, 10);
  let estimatedSkipped = false;
  let ambiguous = false;

  const take = (m: RegExpMatchArray, numIndex: number): number | null => {
    const { before, after } = around(text, m);
    if (PREVIOUS.test(before)) return null;
    if (ESTIMATED.test(after) || ESTIMATED.test(before)) {
      estimatedSkipped = true;
      return null;
    }
    return parseNumber(m[numIndex]!, IMPORT_LIMITS.readingMax);
  };

  const regs: Record<ElectricityRegister, number[]> = { single: [], day: [], night: [] };
  for (const m of text.matchAll(ELEC_RE)) {
    const v = take(m, 3);
    if (v === null) continue;
    const reg = (m[1] ?? m[2])?.toLowerCase() as "day" | "night" | undefined;
    regs[reg ?? "single"].push(v);
  }
  for (const m of text.matchAll(DAY_NIGHT_RE)) {
    const v = take(m, 2);
    if (v !== null) regs[m[1]!.toLowerCase() as "day" | "night"].push(v);
  }
  const electricity: ElectricityReading[] = [];
  for (const reg of ["single", "day", "night"] as const) {
    const vals = distinct(regs[reg]);
    if (vals.length === 1) electricity.push({ register: reg, kwh: vals[0]! });
    else if (vals.length > 1) ambiguous = true;
  }

  const gasVals: number[] = [];
  const gasUnits: GasUnit[] = [];
  for (const m of text.matchAll(GAS_RE)) {
    const v = take(m, 1);
    if (v === null) continue;
    gasVals.push(v);
    const u = gasUnit(m[2]);
    if (u) gasUnits.push(u);
  }
  const gv = distinct(gasVals);
  const gu = distinct(gasUnits);
  if (gv.length > 1) ambiguous = true;
  const gas = gv.length === 1 ? { value: gv[0]!, unit: gu.length === 1 ? gu[0]! : null } : null;

  const dates = distinct([...text.matchAll(DATE_RE)].flatMap((m) => {
    const d = parseDate(m[1]!);
    return d && d <= received ? [d] : [];
  }));
  const readingDate = dates.length === 1 ? dates[0]! : null;

  if (electricity.length === 0 && gas === null) return null;

  const s = `${subject}\n${text.slice(0, 2000)}`.toLowerCase();
  const kind: EonEmailKind = /\b(?:bill|statement)\b/.test(subject.toLowerCase())
    ? "bill"
    : /\breading/.test(s) && /\b(?:thank|received|confirm|submitted)/.test(s) ? "reading" : /\b(?:bill|statement)\b/.test(s) ? "bill" : "other";
  const mt = meterType(text);

  return {
    kind,
    fields: { readingDate, electricity, gas, meterType: mt },
    found: {
      readingDate: readingDate !== null,
      electricity: electricity.length > 0,
      gas: gas !== null,
      gasUnit: gas?.unit != null,
      meterType: mt !== null,
      estimatedSkipped,
      ambiguous,
    },
  };
}
