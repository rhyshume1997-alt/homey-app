import type { FormAction } from "@/components/tasks/types";

export const MEAL_LIMITS = { title: 80, notes: 300, name: 60, quantity: 30, maxIngredients: 30 } as const;
export const MEAL_SLOTS = ["lunch", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const SLOT_LABEL: Record<MealSlot, string> = { lunch: "Lunch", dinner: "Dinner" };

export type Ingredient = {
  id: string;
  meal_id: string;
  name: string;
  quantity: string | null;
  unit_price_estimate: number | null;
  supply_id: string | null;
};

export type Meal = {
  id: string;
  planned_on: string;
  slot: MealSlot;
  title: string;
  notes: string | null;
};

export type MealWithIngredients = Meal & { ingredients: Ingredient[] };

/** The supply fields the stock check reads. Only what people entered. */
export type SupplyRef = { id: string; name: string; status: "ok" | "low" | "out" };

export type MealActions = {
  save: FormAction;
  remove: FormAction;
  copyLastWeek: FormAction;
};

export type NeedStatus = "in" | "low" | "need";
export const NEED_LABEL: Record<NeedStatus, string> = { in: "In", low: "Low", need: "Need" };

export type NeededItem = {
  key: string;
  name: string;
  quantity: string | null;
  status: NeedStatus;
  /** Known estimate for one purchase of this item, or null when nobody entered one. */
  price: number | null;
  meals: string[];
};

export type NeededTotals = {
  needed: number;
  in: number;
  missing: number;
  /** Sum of known estimates for missing items only. */
  estimate: number;
  pricesUnknown: number;
};

/* ---------- dates (calendar dates only, no time zones) ---------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && ISO.test(v) && !Number.isNaN(utc(v)) && new Date(utc(v)).toISOString().slice(0, 10) === v;

export function addDays(date: string, n: number): string {
  return new Date(utc(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday on or before a YYYY-MM-DD date. */
export function mondayOf(date: string): string {
  const dow = (new Date(utc(date)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

/** Today's calendar date in the household's zone. */
export function todayLondon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** ?w= value to the Monday of that week; anything invalid means the current week. */
export function resolveWeek(w: string | string[] | undefined, today: string): string {
  const v = Array.isArray(w) ? w[0] : w;
  return mondayOf(isIsoDate(v) ? v : today);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/* ---------- ingredients needed ---------- */

export const normaliseName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const RANK: Record<NeedStatus, number> = { in: 0, low: 1, need: 2 };

/**
 * Aggregates a week's ingredients by normalised name. A linked supply (supply_id) wins over a
 * name match. "In" only when that supply's status is 'ok', "Low" when 'low', otherwise "Need":
 * no supply, or an 'out' one, is never assumed to be in stock.
 */
export function aggregateNeeded(meals: readonly MealWithIngredients[], supplies: readonly SupplyRef[]): NeededItem[] {
  const byId = new Map(supplies.map((s) => [s.id, s]));
  const byName = new Map(supplies.map((s) => [normaliseName(s.name), s]));
  const groups = new Map<string, { name: string; qty: string[]; prices: number[]; linked: SupplyRef[]; meals: Set<string> }>();
  for (const meal of meals) {
    for (const ing of meal.ingredients) {
      const key = normaliseName(ing.name);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name: ing.name.trim().replace(/\s+/g, " "), qty: [], prices: [], linked: [], meals: new Set() }));
      const q = ing.quantity?.trim();
      if (q && !g.qty.includes(q)) g.qty.push(q);
      if (ing.unit_price_estimate !== null) g.prices.push(ing.unit_price_estimate);
      const s = ing.supply_id ? byId.get(ing.supply_id) : undefined;
      if (s) g.linked.push(s);
      g.meals.add(meal.title);
    }
  }
  const items: NeededItem[] = [];
  for (const [key, g] of groups) {
    const named = byName.get(key);
    const matches = g.linked.length ? g.linked : named ? [named] : [];
    let status: NeedStatus = "need";
    if (matches.length) {
      // The worst matching supply decides.
      status = matches.reduce<NeedStatus>((w, s) => {
        const st: NeedStatus = s.status === "ok" ? "in" : s.status === "low" ? "low" : "need";
        return RANK[st] > RANK[w] ? st : w;
      }, "in");
    }
    items.push({
      key,
      name: g.name,
      quantity: g.qty.length ? g.qty.join(" + ").slice(0, 40) : null,
      status,
      price: g.prices.length ? Math.max(...g.prices) : null,
      meals: [...g.meals],
    });
  }
  const order: Record<NeedStatus, number> = { need: 0, low: 1, in: 2 };
  return items.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export const isMissing = (i: Pick<NeededItem, "status">) => i.status !== "in";

export function totalsOf(items: readonly NeededItem[]): NeededTotals {
  const missing = items.filter(isMissing);
  const known = missing.filter((i) => i.price !== null);
  return {
    needed: items.length,
    in: items.length - missing.length,
    missing: missing.length,
    estimate: Math.round(known.reduce((n, i) => n + (i.price ?? 0), 0) * 100) / 100,
    pricesUnknown: missing.length - known.length,
  };
}

export const formatMoney = (n: number) => `£${n.toFixed(2)}`;
