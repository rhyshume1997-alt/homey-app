import "server-only";
import { MEAL_LIMITS } from "@/components/meals/types";
import { IMPORT_LIMITS, IMPORT_MSG, type PreviewResult, type RecipeSource } from "@/contracts/recipe-import";
import { FetchBlocked, checkUrl, safeFetch, type SafeFetchDeps } from "./ssrf";
import { extractIngredientLines, recipeFromHtml, titleFromText, toIngredients } from "./parse";

/* ---------- per-user rate limit (in memory, per server instance) ---------- */

export const RATE = { limit: 10, windowMs: 10 * 60_000 } as const;
const hits = new Map<string, number[]>();

/** True when this user may fetch another link now; records the attempt. */
export function allowFetch(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE.windowMs);
  if (recent.length >= RATE.limit) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  // Keep the map from growing without bound.
  if (hits.size > 1_000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE.windowMs)) hits.delete(k);
  return true;
}
export function resetRateLimit(): void {
  hits.clear();
}

/* ---------- source detection ---------- */

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "vm.tiktok.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);

export function sourceOf(url: URL): Exclude<RecipeSource, "text"> {
  const h = url.hostname.toLowerCase().replace(/\.$/, "");
  if (TIKTOK_HOSTS.has(h)) return "tiktok";
  if (INSTAGRAM_HOSTS.has(h)) return "instagram";
  return "website";
}

/* ---------- the three paths ---------- */

function fromText(text: string, source: RecipeSource, fallbackTitle: string): PreviewResult | null {
  const { ingredients, truncated } = toIngredients(extractIngredientLines(text));
  if (!ingredients.length) return null;
  const title = titleFromText(text) || fallbackTitle;
  return { ok: true, preview: { title: title.slice(0, MEAL_LIMITS.title), ingredients, source, ...(truncated ? { truncated } : {}) } };
}

async function tiktokCaption(url: URL, deps: SafeFetchDeps): Promise<string | null> {
  const oembed = async (u: URL) => {
    const r = await safeFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.toString())}`, deps);
    if (r.kind !== "json") return null;
    const data = JSON.parse(r.text) as { title?: unknown };
    return typeof data.title === "string" ? data.title : null;
  };
  try {
    return await oembed(url);
  } catch {
    // Short vm.tiktok.com links: follow the redirect (under the same guard) and try the full link.
    if (url.hostname.toLowerCase() !== "vm.tiktok.com") return null;
    try {
      const r = await safeFetch(url.toString(), deps);
      return sourceOf(r.finalUrl) === "tiktok" && r.finalUrl.hostname !== "vm.tiktok.com" ? await oembed(r.finalUrl) : null;
    } catch {
      return null;
    }
  }
}

/** Builds a preview from a link. Never saves; never logs the URL or the page. */
export async function previewFromUrl(raw: unknown, userId: string, deps: SafeFetchDeps = {}): Promise<PreviewResult> {
  let url: URL;
  try {
    url = checkUrl(typeof raw === "string" ? raw.slice(0, IMPORT_LIMITS.url + 1) : raw);
  } catch (e) {
    const code = e instanceof FetchBlocked ? e.code : "bad_url";
    return { ok: false, error: code === "bad_url" || code === "not_https" ? IMPORT_MSG.invalidUrl : IMPORT_MSG.blocked };
  }
  const source = sourceOf(url);
  // Instagram gives captions only to apps with a Meta token: don't fetch, say so plainly.
  if (source === "instagram") return { ok: false, error: IMPORT_MSG.instagram, source };
  if (!allowFetch(userId)) return { ok: false, error: IMPORT_MSG.rate, source };

  if (source === "tiktok") {
    const caption = await tiktokCaption(url, deps);
    if (caption === null) return { ok: false, error: IMPORT_MSG.tiktokFailed, source };
    return fromText(caption, "tiktok", "Recipe from TikTok") ?? { ok: false, error: IMPORT_MSG.tiktokNone, source };
  }

  try {
    const r = await safeFetch(url.toString(), deps);
    if (r.kind !== "html") return { ok: false, error: IMPORT_MSG.noRecipe, source };
    const found = recipeFromHtml(r.text);
    if (!found) return { ok: false, error: IMPORT_MSG.noRecipe, source };
    return {
      ok: true,
      preview: { title: found.title, ingredients: found.ingredients, source: "website", ...(found.truncated ? { truncated: true } : {}) },
    };
  } catch (e) {
    const code = e instanceof FetchBlocked ? e.code : "network";
    const blocked = ["credentials", "port", "ip_literal", "blocked_host", "private_address"].includes(code);
    return { ok: false, error: blocked ? IMPORT_MSG.blocked : IMPORT_MSG.fetchFailed, source };
  }
}

/** The paste box: same extractor, no network. */
export function previewFromText(raw: unknown): PreviewResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: IMPORT_MSG.textEmpty, source: "text" };
  return fromText(raw.slice(0, IMPORT_LIMITS.text), "text", "") ?? { ok: false, error: IMPORT_MSG.textNone, source: "text" };
}
