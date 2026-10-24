/**
 * Whether the snag list is shown (Snags tab, Home card, Homey reminders). A per-person display
 * preference in user_metadata, parsed as untrusted: anything but an explicit `true` keeps snags shown.
 * Hiding never deletes or changes a snag; the /snags page still opens.
 */
export function parseShowSnags(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return true;
  return (meta as Record<string, unknown>).snags_hidden !== true;
}
