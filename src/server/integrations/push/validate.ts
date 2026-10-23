import { z } from "zod";

const b64url = /^[A-Za-z0-9_-]+={0,2}$/;

/** A browser PushSubscription as sent by the client. p256dh is a 65-byte P-256 point, auth 16 bytes. */
export const endpointSchema = z
  .string()
  .max(1000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.port === "" && isPushServiceHost(u.hostname);
    } catch {
      return false;
    }
  }, "endpoint must be a known push service");

/** Browser push services only: the server POSTs to this URL, so arbitrary hosts would be SSRF. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^web\.push\.apple\.com$/];
export function isPushServiceHost(host: string): boolean {
  return PUSH_HOSTS.some((re) => re.test(host.toLowerCase()));
}

export const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  p256dh: z.string().regex(b64url).min(80).max(100),
  auth: z.string().regex(b64url).min(20).max(30),
  userAgent: z.string().max(200).optional(),
});

export type PushSubscriptionInput = z.infer<typeof subscriptionSchema>;

export const payloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(300),
  link: z
    .string()
    .max(300)
    .refine((v) => v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && !/[\r\n]/.test(v), "link must be a relative path"),
});

export type PushPayload = z.infer<typeof payloadSchema>;
