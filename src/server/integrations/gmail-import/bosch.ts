import "server-only";
import { IMPORT_LIMITS, type ApplianceFields, type ApplianceFound, type BoschEmailKind } from "@/contracts/email-import";
import { DATE_SRC, addYears, distinct, parseDate, parseSmallInt, safeText } from "./text";

/**
 * Deterministic parser for Bosch order, registration and warranty emails. Regex only, no LLM.
 * Missing or conflicting fields are null, never guessed. The input text is untrusted.
 */

export interface BoschParse {
  kind: BoschEmailKind;
  fields: ApplianceFields;
  found: ApplianceFound;
  modelOptions: string[];
}

const SEP = "[\\s:|#\\-–]{0,6}";

/** Bosch model / E-Nr: 2-4 letters, a digit, 3-12 letters or digits, optional "/01" variant. */
const MODEL_VALUE = /^[A-Z]{2,4}[0-9][0-9A-Z]{3,12}(?:\/[0-9]{2})?$/;
const MODEL_LABEL = /\b(?:e-?nr\.?|e-?number|model(?:\s+(?:number|no\.?|code))?|product\s+(?:number|code)|type\s+(?:number|no\.?))[\s:|#\-–]{0,6}([A-Za-z0-9/]{5,20})/gi;
/** Known Bosch range prefixes, for model codes printed without a label. Upper case only. */
const MODEL_BARE = /\b((?:SMS|SMV|SMI|SMD|SMU|SPS|SPV|SPI|SRS|SRV|WAN|WAJ|WAU|WAV|WAW|WAX|WGG|WGB|WGE|WTH|WTN|WTR|WTW|WQB|WNA|WNG|WVG|WKD|KGN|KGV|KGE|KIV|KIN|KIR|KAN|KAG|KAI|KSV|GSN|GIV|HBS|HBA|HBG|HBF|HBD|HRS|HMT|HMB|HQA|BFL|BEL|PIE|PKE|PUE|PXE|PXY|PKF|PVS|PIF|DWB|DFS|DFR|DWK|DHL|BGS|BCS|BBS|TIS|CTL|CMG|CBG)[0-9][0-9A-Z]{3,10}(?:\/[0-9]{2})?)\b/g;

const PURCHASE_LABEL =
  "order\\s+date|date\\s+of\\s+(?:order|purchase)|date\\s+(?:ordered|purchased)|ordered\\s+on|order\\s+placed(?:\\s+on)?|purchase\\s+date|purchased\\s+on|invoice\\s+date";
const WARRANTY_LABEL =
  "(?:warranty|guarantee)\\s+(?:end|expiry|expiration)\\s+date|(?:warranty|guarantee)\\s+(?:expires|ends|end|valid\\s+until|until)(?:\\s+on)?|covered\\s+until";
const YEARS_RE =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]+years?['’]?\s+(?:(?:extended|free|full|manufacturer['’]?s?|parts\s+and\s+labour|bosch)\s+){0,3}(?:guarantee|warranty)\b/gi;
const PRODUCT_LABEL = /^(?:product(?:\s+name)?|item|description|appliance)\s*[:|]\s*(.{3,})$/i;
const SERIES_LINE = /\bseries\s?[2-8]\b.{0,60}\b(?:dishwasher|washing machine|washer dryer|tumble dryer|dryer|fridge freezer|fridge|freezer|oven|hob|hood|microwave|cooker|vacuum)\b/i;

function labelledDates(text: string, label: string): string[] {
  const re = new RegExp(`\\b(?:${label})${SEP}(${DATE_SRC})`, "gi");
  return distinct([...text.matchAll(re)].flatMap((m) => {
    const d = parseDate(m[1]!);
    return d ? [d] : [];
  }));
}

const base = (m: string) => m.replace(/\/\d{2}$/, "");

/** Distinct model codes, merged on the base code (a "/01" variant wins over the bare code). */
function models(text: string): { labelled: string[]; bare: string[] } {
  const merge = (xs: string[]) => {
    const byBase = new Map<string, string>();
    for (const x of xs) {
      const prev = byBase.get(base(x));
      if (!prev || (x.includes("/") && !prev.includes("/"))) byBase.set(base(x), x);
    }
    return [...byBase.values()];
  };
  const labelled = [...text.matchAll(MODEL_LABEL)].map((m) => m[1]!).filter((v) => MODEL_VALUE.test(v));
  const bare = [...text.matchAll(MODEL_BARE)].map((m) => m[1]!).filter((v) => MODEL_VALUE.test(v));
  return { labelled: merge(labelled), bare: merge(bare) };
}

function productName(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = PRODUCT_LABEL.exec(line);
    if (m && /[A-Za-z]{3}/.test(m[1]!)) return safeText(m[1]!, IMPORT_LIMITS.productName);
  }
  for (const line of text.split("\n")) {
    const m = SERIES_LINE.exec(line);
    if (m) return safeText(m[0], IMPORT_LIMITS.productName);
  }
  return null;
}

function kindOf(subject: string, text: string): BoschEmailKind {
  const s = `${subject}\n${text.slice(0, 3000)}`.toLowerCase();
  if (/order\s+confirm|your\s+order|thank\s+you\s+for\s+your\s+order|order\s+number/.test(s)) return "order";
  if (/registration|registered|register\s+your/.test(s)) return "registration";
  if (/warranty|guarantee/.test(s)) return "warranty";
  return "other";
}

/**
 * Parses one Bosch email. `receivedAt` (ISO) bounds the purchase date: a purchase after the email
 * arrived is rejected. Returns null when the email does not describe an appliance.
 */
export function parseBoschEmail(input: { subject: string; text: string; receivedAt: string }): BoschParse | null {
  const { text, subject } = input;
  const received = input.receivedAt.slice(0, 10);

  const { labelled, bare } = models(text);
  const pool = labelled.length > 0 ? labelled : bare;
  const model = pool.length === 1 ? pool[0]! : null;
  const modelOptions = pool.length > 1 ? pool.slice(0, 5) : [];

  const purchases = labelledDates(text, PURCHASE_LABEL).filter((d) => d <= received);
  const purchaseDate = purchases.length === 1 ? purchases[0]! : null;

  const ends = labelledDates(text, WARRANTY_LABEL).filter((d) => !purchaseDate || d > purchaseDate);
  const explicitEnd = ends.length === 1 ? ends[0]! : null;

  const years = distinct([...text.matchAll(YEARS_RE)].flatMap((m) => {
    const n = parseSmallInt(m[1]!);
    return n !== null && n >= 1 && n <= 15 ? [n] : [];
  }));
  const warrantyYears = years.length === 1 ? years[0]! : null;

  let warrantyEnd = explicitEnd;
  let warrantyComputed = false;
  if (!warrantyEnd && purchaseDate && warrantyYears) {
    warrantyEnd = addYears(purchaseDate, warrantyYears);
    warrantyComputed = warrantyEnd !== null;
  }

  const name = productName(text);
  const kind = kindOf(subject, text);
  const hasThing = model !== null || modelOptions.length > 0 || name !== null;
  const hasContext = kind !== "other" || purchaseDate !== null || warrantyEnd !== null;
  if (!hasThing || !hasContext) return null;

  return {
    kind,
    fields: { make: "Bosch", model, productName: name, purchaseDate, warrantyEnd, warrantyComputed, warrantyYears },
    found: {
      model: model !== null,
      productName: name !== null,
      purchaseDate: purchaseDate !== null,
      warrantyEnd: explicitEnd !== null,
      warrantyYears: warrantyYears !== null,
    },
    modelOptions,
  };
}
