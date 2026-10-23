export const APPEARANCES = ["dark", "light", "system"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  dark: "Dark",
  light: "Light",
  system: "Match phone",
};

/** Reads the display preference from Supabase user_metadata. Dark unless the member chose otherwise. */
export function parseAppearance(meta: unknown): Appearance {
  const v = meta && typeof meta === "object" ? (meta as Record<string, unknown>).appearance : undefined;
  return APPEARANCES.includes(v as Appearance) ? (v as Appearance) : "dark";
}
