/**
 * The one date formatter for the app. Each user picks the order of day, month and year
 * and how the month is shown; the choice lives in their Supabase user_metadata and is
 * validated here on every read, so a bad value just falls back to the default.
 */

export const DATE_ORDERS = ["DMY", "MDY", "YMD"] as const;
export const MONTH_STYLES = ["numeric", "short", "long"] as const;

export type DateOrder = (typeof DATE_ORDERS)[number];
export type MonthStyle = (typeof MONTH_STYLES)[number];
export type DatePrefs = { order: DateOrder; month: MonthStyle };

/** UK default: 21/Oct/2026. */
export const DEFAULT_DATE_PREFS: DatePrefs = { order: "DMY", month: "short" };

export const ORDER_LABELS: Record<DateOrder, string> = {
  DMY: "Day / Month / Year",
  MDY: "Month / Day / Year",
  YMD: "Year / Month / Day (ISO with numbers)",
};
export const MONTH_LABELS: Record<MonthStyle, string> = {
  numeric: "Number (10)",
  short: "Short name (Oct)",
  long: "Full name (October)",
};

const isOrder = (v: unknown): v is DateOrder => DATE_ORDERS.includes(v as DateOrder);
const isMonth = (v: unknown): v is MonthStyle => MONTH_STYLES.includes(v as MonthStyle);

/** Reads prefs from untrusted user metadata. */
export function parseDatePrefs(meta: unknown): DatePrefs {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  return {
    order: isOrder(m.date_order) ? m.date_order : DEFAULT_DATE_PREFS.order,
    month: isMonth(m.date_month) ? m.date_month : DEFAULT_DATE_PREFS.month,
  };
}

const TZ = "Europe/London";

// Built once: constructing an Intl.DateTimeFormat costs far more than using one, and
// formatDate runs for every row of every list.
let ukParts: Intl.DateTimeFormat | null = null;
function ukFormatter(): Intl.DateTimeFormat {
  return (ukParts ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }));
}

// en-US month names, as toLocaleString("en-US", { month }) gives them.
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** Same result as new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", { month, timeZone: "UTC" }). */
const monthName = (m: number, names: readonly string[]) =>
  Number.isInteger(m) ? names[(((m - 1) % 12) + 12) % 12] : "Invalid Date";

function parts(input: string | Date): { y: number; m: number; d: number; time?: string } | null {
  // A plain calendar date (YYYY-MM-DD) has no time zone: format it as written.
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-").map(Number) as [number, number, number];
    return { y, m, d };
  }
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return null;
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const x of ukFormatter().formatToParts(date)) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), time: `${p.hour}:${p.minute}` };
}

/**
 * Display only: stored dates stay ISO (YYYY-MM-DD) and timestamps stay ISO UTC.
 * Formats a calendar date ("2026-10-21") or a timestamp (shown in UK time).
 * `withTime` appends ", 12:48" for timestamps.
 */
export function formatDate(input: string | Date, prefs: DatePrefs = DEFAULT_DATE_PREFS, withTime = false): string {
  const p = parts(input);
  if (!p) return "";
  const year = String(p.y);
  let out: string;
  if (prefs.month === "long") {
    // Written style: 21 October 2026 / October 21 2026 / 2026 October 21.
    const name = monthName(p.m, MONTH_LONG);
    const day = String(p.d);
    out = (prefs.order === "DMY" ? [day, name, year] : prefs.order === "MDY" ? [name, day, year] : [year, name, day]).join(" ");
  } else {
    const month =
      prefs.month === "numeric"
        ? String(p.m).padStart(2, "0")
        : monthName(p.m, MONTH_SHORT);
    const day = String(p.d).padStart(2, "0");
    const ordered = prefs.order === "DMY" ? [day, month, year] : prefs.order === "MDY" ? [month, day, year] : [year, month, day];
    // Year-first with a numeric month is ISO 8601: 2026-10-21.
    out = ordered.join(prefs.order === "YMD" && prefs.month === "numeric" ? "-" : "/");
  }
  return withTime && p.time ? `${out}, ${p.time}` : out;
}
