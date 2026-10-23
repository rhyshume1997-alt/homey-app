import "server-only";
import type { Session } from "./session";

export type AccessDecision = "allow" | "redirect-login" | "unauthorized" | "landing";

/** Paths that match exactly (case-sensitive, no trailing slash). */
const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  "/login",
  // Public pages for visitors and Google's OAuth verification: what the app is, privacy, terms.
  "/welcome",
  "/privacy",
  "/terms",
  "/auth/login",
  "/auth/callback",
  "/_next/image",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest",
  "/api/health",
  // Signed ingest endpoints (Apps Script). They verify an HMAC signature themselves.
  "/api/integrations/bins",
  "/api/integrations/gmail",
  // Install icons: browsers fetch these without the session cookie (Add to Home Screen).
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.svg",
  "/icons/apple-touch-icon.png",
  // iOS launch screens: fetched before sign-in. Exact files only (see src/app/pwa.ts).
  "/splash/splash-1320x2868.png",
  "/splash/splash-1206x2622.png",
  "/splash/splash-1290x2796.png",
  "/splash/splash-1179x2556.png",
  "/splash/splash-1284x2778.png",
  "/splash/splash-1170x2532.png",
  "/splash/splash-1125x2436.png",
  "/splash/splash-828x1792.png",
  "/splash/splash-750x1334.png",
]);

const PUBLIC_PREFIXES: readonly string[] = ["/_next/static/"];

/** Anything that could smuggle traversal, encoding or odd separators. */
const SUSPICIOUS = /%|\\|\/\/|(^|\/)\.\.?(\/|$)|[\u0000-\u001f\u007f]/;

function isPublicPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || SUSPICIOUS.test(pathname)) return false;
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname.startsWith(p) && pathname.length > p.length,
  );
}

/**
 * Deny-by-default access decision. Pure: no I/O.
 * `pathname` is the raw (still percent-encoded) URL pathname, no query string.
 */
export function decideAccess(
  pathname: string,
  session: Session | null,
): AccessDecision {
  if (session) return "allow";
  if (isPublicPath(pathname)) return "allow";
  // Signed-out visitors to the root see the public landing page (served in place, URL unchanged).
  if (pathname === "/") return "landing";
  if (pathname === "/api" || pathname.startsWith("/api/")) return "unauthorized";
  return "redirect-login";
}
