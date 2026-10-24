/** Common room names offered as one-tap chips on /rooms. Order is the order shown. */
export const QUICK_ADD_ROOMS = [
  "Kitchen",
  "Living room",
  "Dining room",
  "Bedroom",
  "Bathroom",
  "Hallway",
  "Garden",
  "Garage",
  "Office",
  "Utility room",
  "Loft",
] as const;

/** These can be a household's: a second one gets numbered ("Bedroom 2"). Everything else is shown once. */
const REPEATABLE: ReadonlySet<string> = new Set(["Bedroom", "Bathroom"]);

export type QuickAddChip = { key: string; name: string };

/** Lower case, trimmed, single spaces. Matches the case-insensitive unique index on rooms. */
export function normaliseRoomName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name a new room from this base would get: the base itself if free, else "Base 2", "Base 3"... */
export function nextRoomName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(normaliseRoomName(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(normaliseRoomName(candidate))) return candidate;
  }
}

/**
 * Chips to show given the room names already in the household.
 * Single-use names are hidden once a room with that name exists (any case).
 * Repeatable names are always shown, numbered when one already exists.
 */
export function quickAddChips(existingNames: readonly string[]): QuickAddChip[] {
  const taken = new Set(existingNames.map(normaliseRoomName));
  const chips: QuickAddChip[] = [];
  for (const base of QUICK_ADD_ROOMS) {
    if (REPEATABLE.has(base)) {
      const name = nextRoomName(base, taken);
      chips.push({ key: base, name });
    } else if (!taken.has(normaliseRoomName(base))) {
      chips.push({ key: base, name: base });
    }
  }
  return chips;
}
