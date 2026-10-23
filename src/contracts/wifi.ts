import { z } from "zod";

export const WIFI_SECURITIES = ["WPA", "WEP", "nopass"] as const;
export type WifiSecurity = (typeof WIFI_SECURITIES)[number];
export const WIFI_SECURITY_LABEL: Record<WifiSecurity, string> = { WPA: "WPA/WPA2", WEP: "WEP", nopass: "Open (no password)" };
export const WIFI_LIMITS = { ssid: 32, password: 63 } as const;

/** What the browser may know about a network. Never the password or its ciphertext. */
export const WifiNetworkViewSchema = z.object({
  id: z.uuid(),
  ssid: z.string(),
  security: z.enum(WIFI_SECURITIES),
  hidden: z.boolean(),
  is_guest: z.boolean(),
});
export type WifiNetworkView = z.infer<typeof WifiNetworkViewSchema>;

export const WifiInputSchema = z.object({
  ssid: z.string().min(1).max(WIFI_LIMITS.ssid),
  security: z.enum(WIFI_SECURITIES),
  password: z.string().max(WIFI_LIMITS.password),
  hidden: z.boolean(),
  is_guest: z.boolean(),
});

/** Escapes the characters that are special in a WIFI: QR payload: \ ; , : " */
export function escapeWifiField(v: string): string {
  return v.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

/** Standard wifi join payload, e.g. WIFI:T:WPA;S:name;P:secret;H:false;; */
export function wifiQrPayload(n: { ssid: string; security: WifiSecurity; password: string | null; hidden: boolean }): string {
  const p = n.security === "nopass" || !n.password ? "" : `P:${escapeWifiField(n.password)};`;
  return `WIFI:T:${n.security};S:${escapeWifiField(n.ssid)};${p}H:${n.hidden ? "true" : "false"};;`;
}

export type RevealResult = { ok: true; password: string } | { ok: false; error: string };
