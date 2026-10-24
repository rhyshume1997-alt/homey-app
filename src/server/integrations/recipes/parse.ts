import "server-only";
import { MEAL_LIMITS } from "@/components/meals/types";
import type { ImportedIngredient } from "@/contracts/recipe-import";

/**
 * Pure parsing for recipe imports: schema.org Recipe (JSON-LD, then microdata), free text
 * (captions, pasted recipes) and single ingredient lines. No network, no AI.
 */

/* ---------- text helpers ---------- */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", frac12: "½", frac14: "¼", frac34: "¾",
  frac13: "⅓", frac23: "⅔", frac18: "⅛", deg: "°", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", eacute: "é", egrave: "è", times: "×",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Tags out, entities decoded, whitespace collapsed. */
export function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^<>]{0,2000}>/g, " ")).replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : s.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

/* ---------- one ingredient line ---------- */

const FRACTIONS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
const NUM = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTIONS}])?|[${FRACTIONS}])`;
const RANGE = `${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?`;
const UNITS = [
  "kg", "kilograms?", "kilos?", "g", "grams?", "grammes?", "mg", "ml", "millilit(?:re|er)s?", "cl", "dl", "l", "lit(?:re|er)s?",
  "tsps?", "teaspoons?", "tbsps?", "tbs", "tablespoons?", "dsp", "cups?", "oz", "ounces?", "lbs?", "pounds?", "fl\\.? ?oz",
  "pints?", "quarts?", "pinch(?:es)?", "handfuls?", "cloves?", "tins?", "cans?", "jars?", "packs?", "packets?", "bunch(?:es)?",
  "slices?", "sprigs?", "sticks?", "pieces?", "dash(?:es)?", "splash(?:es)?", "knobs?", "sachets?", "bags?", "heads?", "stalks?",
  "fillets?", "rashers?", "sheets?", "drops?", "cubes?", "bottles?", "punnets?", "balls?", "blocks?", "tubs?", "cartons?", "leaves",
  "bulbs?", "thumbs?", "glugs?", "drizzles?", "scoops?", "portions?", "servings?", "loaf", "loaves", "pots?", "boxes", "box",
];
const UNIT = `(?:${UNITS.join("|")})`;
const WORD_NUM = "(?:a|an|one|two|three|four|five|six|half(?:\\s+an?)?|a\\s+few|a\\s+couple(?:\\s+of)?|a\\s+little|some)";

// "2 tins", "200g", "1½ tbsp", "2 x 400g tins", "1 (400g) tin", "3-4 cloves", "2 large"
const LEAD_QTY = new RegExp(
  `^(${RANGE}(?:\\s*(?:x|×)\\s*${RANGE})?\\s*(?:\\(([^)]{1,20})\\)\\s*)?(?:${UNIT}\\b\\.?)?(?:\\s+${UNIT}\\b\\.?)?)(?:\\s+of\\b)?\\s*`,
  "i",
);
// "a pinch of", "half a tin of", "a handful"
const WORD_QTY = new RegExp(`^(${WORD_NUM}\\s+${UNIT}\\b)(?:\\s+of\\b)?\\s*`, "i");
// "Pasta 200g", "Chicken thighs x4", "Tomatoes - 2 tins"
const TRAIL_QTY = new RegExp(`^(.*?\\S)\\s*(?:[,:–-]\\s*|\\s)\\(?((?:x|×)\\s*\\d+|${RANGE}\\s*${UNIT}\\b\\.?)\\)?$`, "i");
const TO_TASTE = /,?\s*\(?(to taste|to serve|optional|for garnish|to garnish)\)?\s*$/i;

/** Splits "2 tins chopped tomatoes" into { quantity: "2 tins", name: "chopped tomatoes" }. */
export function parseIngredientLine(raw: string): ImportedIngredient | null {
  let line = cleanText(raw)
    .replace(/#[\p{L}\p{N}_]+/gu, " ") // hashtags
    .replace(/^[^\p{L}\p{N}(½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+/u, "") // bullets, dashes, emoji
    .replace(/^\d{1,2}[.)]\s+/, "") // "1. " list numbering
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return null;
  let quantity: string | null = null;
  const lead = LEAD_QTY.exec(line);
  const word = lead ? null : WORD_QTY.exec(line);
  const m = lead && lead[1].trim() ? lead : word;
  if (m && m[0].length < line.length) {
    quantity = m[1].trim();
    line = line.slice(m[0].length);
  } else {
    const t = TRAIL_QTY.exec(line);
    if (t) {
      line = t[1];
      quantity = t[2].trim();
    }
  }
  if (!quantity) {
    const tt = TO_TASTE.exec(line);
    if (tt && tt.index > 0) {
      quantity = tt[1].toLowerCase();
      line = line.slice(0, tt.index);
    }
  }
  const name = clip(line.replace(/^of\s+/i, "").replace(/[\s,;:.–-]+$/, "").replace(/\s+/g, " ").trim(), MEAL_LIMITS.name);
  if (!name || !/\p{L}/u.test(name)) return null;
  return { name, quantity: quantity ? clip(quantity.replace(/\s+/g, " "), MEAL_LIMITS.quantity) : null };
}

/** Dedupes by lower-cased name and caps to what one meal can hold. */
export function toIngredients(lines: readonly string[]): { ingredients: ImportedIngredient[]; truncated: boolean } {
  const seen = new Set<string>();
  const out: ImportedIngredient[] = [];
  let truncated = false;
  for (const l of lines) {
    const p = parseIngredientLine(l);
    if (!p) continue;
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MEAL_LIMITS.maxIngredients) {
      truncated = true;
      break;
    }
    out.push(p);
  }
  return { ingredients: out, truncated };
}

/* ---------- free text (captions and pasted recipes) ---------- */

const HEADING_INGREDIENTS = /^\W*(?:ingredients?|you(?:'|’)?ll need|what you need|shopping list)\b\s*(?:\([^)]*\))?\s*[:：-]?\s*/iu;
const HEADING_STOP =
  /^\W*(?:method|instructions?|directions?|steps?|how to(?: make)?|to make|preparation|prep|recipe|notes?|tips?|serves|enjoy|cook(?:ing)? time|macros|nutrition|full recipe)\b/iu;
const QTY_START = new RegExp(`^(?:${RANGE}|${WORD_NUM}\\s+${UNIT}\\b)`, "i");

function stripMarker(l: string): { text: string; bullet: boolean } {
  const m = /^[\s]*([-–—•·▪◦●○*+✓✔✅➡→▶►🔸🔹]|[\p{Extended_Pictographic}️‍]+)\s*/u.exec(l);
  return m ? { text: l.slice(m[0].length), bullet: true } : { text: l, bullet: false };
}

const onlyHashtags = (l: string) => l.replace(/#[\p{L}\p{N}_]+/gu, "").trim() === "";

/**
 * Ingredient-looking lines in a caption or pasted recipe. Prefers the block after an
 * "Ingredients" heading (until Method/Instructions/etc.); otherwise bullet lines and lines that
 * start with a quantity.
 */
export function extractIngredientLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const found: string[] = [];
  let inSection = false;
  let sawSection = false;
  let gap = false;
  for (const l of lines) {
    if (!l) {
      gap = inSection && found.length > 0;
      continue;
    }
    const h = HEADING_INGREDIENTS.exec(l);
    if (h) {
      inSection = true;
      sawSection = true;
      gap = false;
      const restOfLine = l.slice(h[0].length).trim();
      // "Ingredients: pasta, 2 tins tomatoes, basil" (but not "Ingredients for the sauce:")
      if (restOfLine && !restOfLine.endsWith(":")) found.push(...restOfLine.split(/\s*[,;]\s*/).filter(Boolean));
      continue;
    }
    if (inSection) {
      const { text: t, bullet } = stripMarker(l);
      if (HEADING_STOP.test(t) || onlyHashtags(l)) {
        inSection = false;
        continue;
      }
      // After a blank line, only carry on while lines still look like ingredients.
      if (gap && !bullet && !QTY_START.test(t) && !t.endsWith(":")) {
        inSection = false;
        continue;
      }
      gap = false;
      if (t.endsWith(":")) continue; // "For the sauce:"
      if (t.length <= 120) found.push(t);
    }
  }
  if (sawSection && found.length) return found;
  for (const l of lines) {
    if (!l || onlyHashtags(l) || l.length > 100) continue;
    const { text: t, bullet } = stripMarker(l);
    if (/^\d{1,2}[.)]\s/.test(t)) continue; // numbered method steps
    if (HEADING_STOP.test(t)) continue;
    if (bullet || QTY_START.test(t)) found.push(t);
  }
  return found;
}

/** A short title from the first meaningful caption line, or "". */
export function titleFromText(text: string): string {
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const l = cleanText(raw).replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
    if (!l || l.length < 3) continue;
    if (HEADING_INGREDIENTS.test(l) || HEADING_STOP.test(l) || QTY_START.test(stripMarker(l).text) || stripMarker(l).bullet) return "";
    const sentence = l.split(/(?<=[.!?])\s/)[0];
    return clip(sentence.replace(/[\s.!:]+$/, ""), MEAL_LIMITS.title);
  }
  return "";
}

/* ---------- HTML: schema.org Recipe ---------- */

type Found = { title: string; lines: string[] };

const isRecipeType = (t: unknown): boolean =>
  typeof t === "string" ? /(^|[/#:])recipe$/i.test(t.trim()) : Array.isArray(t) && t.some(isRecipeType);

function ingredientField(node: Record<string, unknown>): string[] {
  const v = node.recipeIngredient ?? node.ingredients;
  const list = typeof v === "string" ? v.split(/\n/) : Array.isArray(v) ? v : [];
  return list.flatMap((x) => (typeof x === "string" ? [cleanText(x)] : [])).filter(Boolean);
}

function walkLd(node: unknown, out: Found[], budget: { n: number }, depth = 0): void {
  if (depth > 10 || budget.n-- <= 0 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walkLd(x, out, budget, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (isRecipeType(o["@type"])) {
    const lines = ingredientField(o);
    const name = typeof o.name === "string" ? o.name : typeof o.headline === "string" ? o.headline : "";
    if (lines.length) out.push({ title: cleanText(name), lines });
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") walkLd(v, out, budget, depth + 1);
}

type Tag = { name: string; raw: string; end: number };

/**
 * Walks the tags of a page in one linear pass (no backtracking regexes over the whole page, so a
 * hostile page can't stall the server). `raw` is the text between < and >; `end` is the index after >.
 */
function* tags(html: string): Generator<Tag> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return;
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) return; // nothing after this can close a tag
    i = gt + 1;
    const raw = html.slice(lt + 1, gt);
    if (raw.length > 4_000) continue;
    const m = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(raw);
    if (m) yield { name: m[1].toLowerCase(), raw, end: gt + 1 };
  }
}

/** Index of `needle` (lower case) in `lower` within `max` chars of `from`, or -1. */
function findWithin(lower: string, needle: string, from: number, max: number): number {
  const at = lower.indexOf(needle, from);
  return at >= 0 && at - from <= max ? at : -1;
}

export function recipeFromJsonLd(html: string): Found | null {
  const lower = html.toLowerCase();
  const out: Found[] = [];
  for (const t of tags(html)) {
    if (t.name !== "script" || !/^application\/ld\+json$/i.test((attr(t.raw, "type") ?? "").trim())) continue;
    const close = lower.indexOf("</script", t.end);
    if (close < 0) break; // unclosed: nothing later can be a complete block
    const body = html.slice(t.end, close).replace(/^\s*(?:<!--|<!\[CDATA\[)/, "").replace(/(?:-->|\]\]>)\s*$/, "").trim();
    try {
      walkLd(JSON.parse(body), out, { n: 5_000 });
    } catch {
      // malformed block: try the next one
    }
    if (out.length) break;
  }
  return out[0] ?? null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\\s>"']{1,2000}))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

const INGREDIENT_PROP = /^(?:recipeIngredient|ingredients)$/i;
const MAX_INGREDIENT_TAGS = 200;

export function recipeFromMicrodata(html: string): Found | null {
  const lower = html.toLowerCase();
  const lines: string[] = [];
  let title = "";
  let seen = 0;
  for (const t of tags(html)) {
    const prop = attr(t.raw, "itemprop");
    if (prop === null) continue;
    const props = prop.trim().split(/\s+/);
    if (!title && props.includes("name")) {
      const close = findWithin(lower, "</", t.end, 300);
      if (close > 0) title = cleanText(html.slice(t.end, close));
    }
    if (!props.some((p) => INGREDIENT_PROP.test(p))) continue;
    if (++seen > MAX_INGREDIENT_TAGS) break;
    const content = attr(t.raw, "content");
    if (t.name === "meta" || content !== null) {
      if (content) lines.push(cleanText(content));
      continue;
    }
    const close = findWithin(lower, `</${t.name}`, t.end, 2_000);
    if (close > t.end) lines.push(cleanText(html.slice(t.end, close)));
  }
  const kept = lines.filter(Boolean);
  if (!kept.length) return null;
  return { title, lines: kept };
}

export function pageTitle(html: string): string {
  const lower = html.toLowerCase();
  let title = "";
  for (const t of tags(html)) {
    if (t.name === "meta") {
      const p = (attr(t.raw, "property") ?? attr(t.raw, "name") ?? "").toLowerCase();
      const c = p === "og:title" ? attr(t.raw, "content") : null;
      if (c) return cleanText(c);
    } else if (t.name === "title" && !title) {
      const close = findWithin(lower, "</title", t.end, 500);
      if (close >= 0) title = cleanText(html.slice(t.end, close));
    }
  }
  return title;
}

/** Parsing reads at most the first 1 MB of a page (fetches allow 2 MB). */
const MAX_PARSE_CHARS = 1_000_000;

export function recipeFromHtml(input: string): { title: string; ingredients: ImportedIngredient[]; truncated: boolean } | null {
  const html = input.length > MAX_PARSE_CHARS ? input.slice(0, MAX_PARSE_CHARS) : input;
  const found = recipeFromJsonLd(html) ?? recipeFromMicrodata(html);
  if (!found) return null;
  const { ingredients, truncated } = toIngredients(found.lines);
  if (!ingredients.length) return null;
  return { title: clip(found.title || pageTitle(html), MEAL_LIMITS.title), ingredients, truncated };
}
