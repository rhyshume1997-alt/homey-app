import { parseShopUrl } from "@/contracts/wishlist";

/**
 * A link out to a shop. The URL is re-checked here at render time (https only, no credentials),
 * so anything unsafe that reached the database renders as plain text, never as a link.
 * It is only ever an anchor: never fetched server side, never passed to redirect().
 */
export function ShopLink({ url }: { url: string | null }) {
  if (!url) return null;
  const safe = parseShopUrl(url);
  if (!safe) return null;
  const host = new URL(safe).hostname.replace(/^www\./, "");
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2"
    >
      Open in {host}
    </a>
  );
}
