/** Pure upload helpers: no I/O, safe to unit test. */
import { MAX_FILE_BYTES, type VaultDocument } from "./types";
import { trafficLight } from "@/components/status";

export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
const HEIC_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"];

/** The type the bytes really are, or null. The declared type is never trusted on its own. */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length >= 5 && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(bytes, 8, 12))) return "image/heic";
  return null;
}

/** Declared type and magic bytes must agree and be allowed. Returns the verified type or null. */
export function verifyMime(declared: string, bytes: Uint8Array): AllowedMime | null {
  const sniffed = sniffMime(bytes);
  if (!sniffed) return null;
  const d = declared.trim().toLowerCase();
  const norm = d === "image/jpg" || d === "image/pjpeg" ? "image/jpeg" : d === "image/heif" ? "image/heic" : d;
  return norm === sniffed ? sniffed : null;
}

export function validSize(size: number): boolean {
  return Number.isInteger(size) && size > 0 && size <= MAX_FILE_BYTES;
}

/** Keeps [A-Za-z0-9._-], max 100 characters (extension preserved), never empty or dot-leading. */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let s = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "");
  if (s.length > 100) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : "";
    s = s.slice(0, 100 - ext.length) + ext;
  }
  return s === "" ? "file" : s;
}

/** Whole days from `today` (local calendar date) to an ISO date; negative when past; null when unset. */
export function daysUntil(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000);
}

/** A Date as its local calendar day, YYYY-MM-DD. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Documents that are expired or expiring soon, soonest first. Uses the shared traffic-light rule
 * (`trafficLight("document", ...)`: amber within EXPIRY_WARNING_DAYS, red once past) so the list
 * badges, the home card and the calendar all agree.
 */
export function expiringSoon(docs: readonly VaultDocument[], today = new Date()): VaultDocument[] {
  const ymd = localYmd(today);
  return docs
    .filter((d) => d.expires_on !== null && trafficLight("document", d.expires_on, ymd) !== "green")
    .sort((a, b) => (a.expires_on! < b.expires_on! ? -1 : a.expires_on! > b.expires_on! ? 1 : 0));
}
