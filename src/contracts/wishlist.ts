import { z } from "zod";

/** Mirrors the wishlist_items migration. */
export const WISHLIST_LIMITS = { title: 120, notes: 500, url: 2048 } as const;

export const WISHLIST_STATUSES = ["idea", "saving", "bought"] as const;
export const WISHLIST_PRIORITIES = ["low", "medium", "high"] as const;
export type WishlistStatus = (typeof WISHLIST_STATUSES)[number];
export type WishlistPriority = (typeof WISHLIST_PRIORITIES)[number];

export const WISHLIST_STATUS_LABEL: Record<WishlistStatus, string> = { idea: "Idea", saving: "Saving for", bought: "Bought" };
export const WISHLIST_PRIORITY_LABEL: Record<WishlistPriority, string> = { low: "Low", medium: "Medium", high: "High" };

/**
 * Returns a normalised https URL, or null if it is not safe to store or render.
 * https only; no credentials; at most 2048 characters. Never fetched or redirected to server side.
 */
export function parseShopUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.length === 0 || raw.length > WISHLIST_LIMITS.url) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (u.hostname === "") return null;
  const href = u.href;
  if (href.length > WISHLIST_LIMITS.url || !/^https:\/\//.test(href)) return null;
  return href;
}

/** A form value: empty means no link; anything else must pass parseShopUrl. */
const urlField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
  z
    .string()
    .nullable()
    .transform((v, ctx) => {
      if (v === null) return null;
      const ok = parseShopUrl(v);
      if (!ok) {
        ctx.addIssue({ code: "custom", message: "invalid url" });
        return z.NEVER;
      }
      return ok;
    }),
);

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
    z.string().trim().max(max).nullable(),
  );

const price = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().replace(/^£/, "").replace(/,/g, "")) : (v ?? null)),
  z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .nullable()
    .transform((v) => (v === null ? null : Math.round(Number(v) * 100) / 100)),
);

const roomId = z.preprocess((v) => (typeof v === "string" && v === "" ? null : (v ?? null)), z.uuid().nullable());

export const WishlistInputSchema = z.object({
  title: z.string().trim().min(1).max(WISHLIST_LIMITS.title),
  room_id: roomId,
  price_estimate: price,
  url: urlField,
  priority: z.enum(WISHLIST_PRIORITIES).default("medium"),
  notes: optText(WISHLIST_LIMITS.notes),
});
export type WishlistInput = z.infer<typeof WishlistInputSchema>;

export type WishlistItem = {
  id: string;
  room_id: string | null;
  title: string;
  price_estimate: number | null;
  url: string | null;
  priority: WishlistPriority;
  status: WishlistStatus;
  photo_document_id: string | null;
  notes: string | null;
  bought_at: string | null;
};

export type WishlistRoom = { id: string; name: string };

export function formatRoughPrice(n: number | null): string | null {
  if (n === null) return null;
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return `Rough price £${s}`;
}
