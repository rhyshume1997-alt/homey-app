import { BIN_LIMITS } from "./schedule";

export const FIND_COUNCIL_URL = "https://www.gov.uk/rubbish-collection-day";

/**
 * Validates a council bin page link. https only, no username/password, at most 500 characters.
 * Returns the normalised URL, or null when it is not acceptable. javascript:, data:, http: and
 * anything that does not parse are all rejected.
 */
export function parseCouncilUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > BIN_LIMITS.url || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
  return u.href.length <= BIN_LIMITS.url ? u.href : null;
}
