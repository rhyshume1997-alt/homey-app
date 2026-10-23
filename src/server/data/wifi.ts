import "server-only";
import { z } from "zod";
import QRCode from "qrcode";
import { createUserClient } from "@/server/db/supabase";
import type { HouseholdSession } from "@/server/auth/session";
import { decryptHouseholdSecret, encryptHouseholdSecret, householdSecretsConfigured } from "@/server/crypto/household-secret";
import { WIFI_SECURITIES, WifiInputSchema, wifiQrPayload, type RevealResult, type WifiNetworkView } from "@/contracts/wifi";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const MSG = {
  invalid: "Please check the details and try again.",
  failed: "Something went wrong. Please try again.",
  load: "Could not load this right now.",
  notSetUp: "Wifi storage isn't set up",
  rate: "Too many reveals. Please wait a minute.",
} as const;

const PURPOSE = "wifi";

/** A network plus its server-rendered QR. The password and ciphertext never leave the server in this shape. */
export type WifiPageNetwork = WifiNetworkView & { hasPassword: boolean; qrSvg: string | null };

const RowSchema = z.object({
  id: z.uuid(),
  ssid: z.string(),
  security: z.enum(WIFI_SECURITIES),
  hidden: z.boolean(),
  is_guest: z.boolean(),
  password_ciphertext: z.string().nullable(),
});

export function parseWifiForm(fd: FormData) {
  const r = WifiInputSchema.safeParse({
    ssid: String(fd.get("ssid") ?? "").trim(),
    security: fd.get("security") ?? "WPA",
    password: String(fd.get("password") ?? ""),
    hidden: fd.get("hidden") === "on",
    is_guest: fd.get("is_guest") === "on",
  });
  return r.success ? r.data : null;
}
export function parseId(v: unknown): string | null {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
}

// Light per-user limiter for reveals (in memory, per server instance): 10 per minute.
const hits = new Map<string, number[]>();
export function allowReveal(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

export async function qrSvgFor(n: { ssid: string; security: (typeof WIFI_SECURITIES)[number]; password: string | null; hidden: boolean }) {
  return QRCode.toString(wifiQrPayload(n), { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}

/** Page data. Decrypts server-side only to render the QR; the client gets the SVG, never the password. */
export async function listWifiForPage(s: HouseholdSession): Promise<Result<WifiPageNetwork[]>> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.load };
  const { data, error } = await db
    .from("wifi_networks")
    .select("id,ssid,security,hidden,is_guest,password_ciphertext")
    .eq("household_id", s.householdId)
    .order("is_guest", { ascending: false })
    .order("created_at", { ascending: true });
  const parsed = z.array(RowSchema).safeParse(data);
  if (error || !parsed.success) return { ok: false, error: MSG.load };
  const out: WifiPageNetwork[] = [];
  for (const { password_ciphertext, ...n } of parsed.data) {
    let qrSvg: string | null = null;
    try {
      const pw = password_ciphertext ? decryptHouseholdSecret(PURPOSE, s.householdId, password_ciphertext) : null;
      qrSvg = await qrSvgFor({ ...n, password: pw });
    } catch {
      qrSvg = null; // key missing or ciphertext unreadable: show the network without a QR
    }
    out.push({ ...n, hasPassword: password_ciphertext !== null, qrSvg });
  }
  return { ok: true, data: out };
}

/** Returns the plaintext password to a signed-in member of the owning household only. */
export async function revealPassword(s: HouseholdSession, id: string): Promise<RevealResult> {
  if (!allowReveal(s.userId)) return { ok: false, error: MSG.rate };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { data } = await db
    .from("wifi_networks")
    .select("password_ciphertext")
    .eq("id", id)
    .eq("household_id", s.householdId)
    .maybeSingle();
  if (!data) return { ok: false, error: MSG.failed };
  if (!data.password_ciphertext) return { ok: true, password: "" };
  try {
    return { ok: true, password: decryptHouseholdSecret(PURPOSE, s.householdId, data.password_ciphertext) };
  } catch {
    return { ok: false, error: MSG.failed };
  }
}

/** Creates (no id) or updates a network. A blank password on update keeps the stored one. */
export async function saveWifi(s: HouseholdSession, id: string | null, input: z.infer<typeof WifiInputSchema>): Promise<Result> {
  if (!householdSecretsConfigured()) return { ok: false, error: MSG.notSetUp };
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { ssid, security, hidden, is_guest } = input;
  let ciphertext: string | null | undefined;
  if (security === "nopass") {
    ciphertext = null;
  } else if (input.password !== "") {
    try {
      ciphertext = encryptHouseholdSecret(PURPOSE, s.householdId, input.password);
    } catch {
      return { ok: false, error: MSG.notSetUp };
    }
  } else if (id) {
    const { data } = await db.from("wifi_networks").select("password_ciphertext").eq("id", id).eq("household_id", s.householdId).maybeSingle();
    ciphertext = data?.password_ciphertext ?? undefined;
  }
  if (ciphertext === undefined) return { ok: false, error: MSG.invalid };
  const row = { ssid, security, hidden, is_guest, password_ciphertext: ciphertext };
  const { error } = id
    ? await db.from("wifi_networks").update(row).eq("id", id).eq("household_id", s.householdId)
    : await db.from("wifi_networks").insert({ ...row, household_id: s.householdId, created_by: s.userId });
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export async function removeWifi(s: HouseholdSession, id: string): Promise<Result> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: MSG.failed };
  const { error } = await db.from("wifi_networks").delete().eq("id", id).eq("household_id", s.householdId);
  return error ? { ok: false, error: MSG.failed } : { ok: true, data: undefined };
}

export { householdSecretsConfigured };
