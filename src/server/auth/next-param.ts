/**
 * Sanitise a post-login `next` target. Returns a same-origin relative
 * path (+ query) or null. Prevents open redirects.
 */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const base = "http://internal.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base) return null;
    const out = u.pathname + u.search;
    if (!out.startsWith("/") || out.startsWith("//")) return null;
    return out;
  } catch {
    return null;
  }
}
