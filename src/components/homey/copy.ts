/**
 * Homey's words (D18). Plain strings only, no runtime dependencies, so it is safe on client and server.
 * Voice rules are in docs/homey-voice.md. In short: friendly, short (<= ~90 characters a line, at most
 * two sentences), UK English, never a money amount or "£", and never a claim about something the
 * user has not confirmed.
 */
import type { Light } from "@/components/status";
import type { Expression, NeedItem } from "./types";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export const GREETINGS: Record<TimeOfDay, string> = {
  morning: "Morning, {name}. Here's what needs doing today.",
  afternoon: "Afternoon, {name}. Here's how the house is looking.",
  evening: "Evening, {name}. Let's wind down together.",
};

/** Local hour (0-23) to the greeting slot. */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** Shown on first open. The first line is exact and must not change. */
export const FIRST_OPEN: readonly string[] = [
  "Hello, I'm your Homey, your AI assistant for this app",
  "I can keep an eye on bins, tasks and renewals for you.",
  "I'll only suggest things. Nothing changes unless you say so.",
];

export const TAP_HINT = {
  again: "Want my help? Tap me again",
  hide: "Tap 3 times to hide me",
  dontShow: "Don't show me this again",
} as const;

export const HIDDEN_TOAST = "Homey's hidden. Bring him back in More > Homey";

export const EMPTY_STATE: readonly string[] = [
  "All clear today. Nicely done.",
  "Nothing needs doing right now.",
  "Nothing urgent. Enjoy the quiet.",
];

/** Every kind a NeedItem can carry. */
export type NeedKind = NeedItem["kind"];

/** Speech bubble lines, keyed by kind and then by light. Missing pairs fall back to FALLBACK_BUBBLE. */
export const BUBBLE: { [K in NeedKind]?: Partial<Record<Light, string>> } = {
  bins: { amber: "Bins out tonight: {bins}" },
  task: { red: "{title} is overdue. Want to tackle it?" },
  renewal: { amber: "{title} renews {when}. Add a reminder?" },
  figures: { amber: "{n} figures still need checking" },
  activity: { green: "{name} {did}. Say thanks?" },
};

export const FALLBACK_BUBBLE = "Something needs a look. Want to check it?";

/** Drafted thank-you notes. The user reviews and taps Send; Homey never sends on its own. */
export const THANKS: readonly string[] = [
  "Thanks for sorting the {thing}, {name}. Really appreciated 💜",
  "{name}, you're a star for the {thing}. Thank you 💜",
  "Thank you for doing the {thing}, {name}. It made things much easier 💜",
  "Cheers, {name}. The {thing} is sorted thanks to you 💜",
  "Couldn't have done the {thing} without you, {name}. Thank you 💜",
  "Thanks a lot for the {thing}, {name}. Lovely work 💜",
];

/** Moments Homey reacts to. Each maps to a face. */
export type HomeyEvent =
  | "greet"
  | "first_open"
  | "all_clear"
  | "overdue"
  | "due_soon"
  | "figures"
  | "thanks_drafted"
  | "thanks_sent"
  | "tip"
  | "hidden"
  | "idle";

export const EXPRESSION_FOR_EVENT: Record<HomeyEvent, Expression> = {
  greet: "smiley",
  first_open: "excited",
  all_clear: "happy",
  overdue: "shocked",
  due_soon: "concerned",
  figures: "surprised",
  thanks_drafted: "happy",
  thanks_sent: "excited",
  tip: "smiley",
  hidden: "sleepy",
  idle: "sleepy",
};

export type Vars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Fills {placeholders} in one pass. Unknown, missing, null or object values are dropped.
 * Values are never re-scanned, so a value containing "{x}" stays literal. Left-over
 * punctuation from a dropped value is tidied ("Thanks, {name}." becomes "Thanks.").
 */
export function fill(template: string, vars: Vars = {}): string {
  const filled = template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return "";
    const value = vars[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  });
  return filled
    .replace(/,\s*(?=[.!?]|$)/g, "")
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The bubble line for a need. Singular figures get their own wording. */
export function bubbleFor(kind: NeedKind, light: Light, vars: Vars = {}): string {
  if (kind === "figures" && vars.n === 1) return fill("1 figure still needs checking", vars);
  return fill(BUBBLE[kind]?.[light] ?? FALLBACK_BUBBLE, vars);
}
