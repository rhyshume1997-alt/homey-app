import "server-only";

/**
 * Pure text helpers for email import. Everything here is deterministic (no LLM) and treats the
 * email as untrusted: bodies are capped, HTML is stripped with a linear scan, links are removed
 * and extracted values are cleaned and length-capped. Nothing here logs or stores text.
 */

/** Largest decoded body part we look at. Anything beyond is ignored. */
export const MAX_PART_BYTES = 512 * 1024;

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p", "div", "tr", "li", "ul", "ol", "table", "tbody", "thead", "section", "article", "header", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "center",
]);
const SKIP_TAGS: ReadonlySet<string> = new Set(["script", "style", "head", "title", "noscript", "template"]);

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", pound: "£", euro: "€", sup2: "²", sup3: "³",
  ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: "·", bull: "·", hellip: "...",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return " ";
      return String.fromCodePoint(n);
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** HTML to plain text in one linear pass. Script/style/head content is dropped; cells become " | ". */
export function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  const n = html.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const e = html.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      out += " ";
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // unterminated tag: drop the rest
    const inner = lower.slice(lt + 1, Math.min(gt, lt + 40));
    const closing = inner.startsWith("/");
    const name = /^\/?\s*([a-z][a-z0-9]*)/.exec(inner)?.[1] ?? "";
    if (!closing && SKIP_TAGS.has(name)) {
      const end = lower.indexOf(`</${name}`, gt + 1);
      const endGt = end < 0 ? -1 : lower.indexOf(">", end);
      i = endGt < 0 ? n : endGt + 1;
      out += "\n";
      continue;
    }
    if (name === "br" || (BLOCK_TAGS.has(name) && closing)) out += "\n";
    else if (closing && (name === "td" || name === "th")) out += " | ";
    else out += " ";
    i = gt + 1;
  }
  return decodeEntities(out);
}

const URL_RE = /\b(?:https?:\/\/|www\.|mailto:)[^\s<>"']*/gi;

/** Normalised text for parsing: no links, single spaces, trimmed lines, no empty lines. */
export function normaliseText(s: string): string {
  return s
    .replace(URL_RE, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‍﻿]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t  ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** A short, display-safe value: tags, links, addresses and control characters removed; capped. */
export function safeText(s: string, max: number): string | null {
  const t = decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/<[^>]*>?/g, " ")
    .replace(URL_RE, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f​-‍﻿]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return Array.from(t).slice(0, max).join("").trim();
}

// ---- MIME -------------------------------------------------------------------------------

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

function charsetOf(part: GmailPart): string {
  const ct = part.headers?.find((h) => h.name?.toLowerCase() === "content-type")?.value ?? "";
  return /charset="?([A-Za-z0-9_-]{1,40})"?/i.exec(ct)?.[1]?.toLowerCase() ?? "utf-8";
}

function decodePart(part: GmailPart): string | null {
  const data = part.body?.data;
  if (typeof data !== "string" || data.length === 0) return null;
  const bytes = Buffer.from(data.slice(0, Math.ceil((MAX_PART_BYTES * 4) / 3) + 4), "base64url").subarray(0, MAX_PART_BYTES);
  let dec: TextDecoder;
  try {
    dec = new TextDecoder(charsetOf(part));
  } catch {
    dec = new TextDecoder("utf-8");
  }
  return dec.decode(bytes);
}

/**
 * The plain and HTML bodies of a Gmail "full" payload, both as normalised text. Attachments are
 * skipped. Walks at most 8 levels and 50 parts. The result lives in memory only.
 */
export function bodyTexts(payload: GmailPart | undefined): { plain: string | null; html: string | null } {
  let plain: string | null = null;
  let html: string | null = null;
  let seen = 0;
  const walk = (p: GmailPart | undefined, depth: number) => {
    if (!p || depth > 8 || seen++ > 50) return;
    const type = (p.mimeType ?? "").toLowerCase();
    const attachment = Boolean(p.filename) || Boolean(p.body?.attachmentId);
    if (!attachment && type === "text/plain" && plain === null) plain = decodePart(p);
    else if (!attachment && type === "text/html" && html === null) html = decodePart(p);
    for (const c of p.parts ?? []) walk(c, depth + 1);
  };
  walk(payload, 0);
  return {
    plain: plain === null ? null : normaliseText(plain),
    html: html === null ? null : normaliseText(htmlToText(html)),
  };
}

// ---- dates and numbers ------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const MONTH_SRC = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

/** Regex source for a date in the formats parseDate understands (UK day-first only). */
export const DATE_SRC =
  `(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]{0,6},?\\s+)?` +
  `(?:\\d{4}-\\d{2}-\\d{2}` +
  `|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-](?:\\d{4}|\\d{2})` +
  `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_SRC})\\.?,?\\s+\\d{4}` +
  `|(?:${MONTH_SRC})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`;

export function isoDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A real calendar date as yyyy-mm-dd, or null. Numeric dates are read day first (UK). */
export function parseDate(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]{0,6},?\s+/, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(s);
  if (m) return isoDate(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]!]) return isoDate(+m[3]!, MONTHS[m[2]!]!, +m[1]!);
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1]!]) return isoDate(+m[3]!, MONTHS[m[1]!]!, +m[2]!);
  return null;
}

/** yyyy-mm-dd plus whole years; 29 Feb becomes 28 Feb when the target year has none. */
export function addYears(iso: string, years: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1]! + years;
  return isoDate(y, +m[2]!, +m[3]!) ?? isoDate(y, +m[2]!, +m[3]! - 1);
}

/** Regex source for a reading: 12345, 12,345, 12345.6 (at most 8 digits, 3 decimals). */
export const NUMBER_SRC = "\\d{1,3}(?:,\\d{3}){1,2}(?:\\.\\d{1,3})?|\\d{1,8}(?:\\.\\d{1,3})?";

export function parseNumber(raw: string, max: number): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^\d{1,8}(?:\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
export function parseSmallInt(raw: string): number | null {
  const s = raw.toLowerCase();
  const n = WORD_NUMBERS[s] ?? (/^\d{1,2}$/.test(s) ? Number(s) : NaN);
  return Number.isInteger(n) ? n : null;
}

/** All distinct values in insertion order. */
export function distinct<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
