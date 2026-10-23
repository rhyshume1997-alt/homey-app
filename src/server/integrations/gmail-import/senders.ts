import "server-only";
import type { ImportKind, ImportSender } from "@/contracts/email-import";
import { addressParts } from "@/server/integrations/google/gmail";

/**
 * Server-side sender allowlist (D18). A message is read only when ALL hold:
 *  - exactly one From header with exactly one address, whose domain is an EXACT allowlist match
 *    (no subdomains, no look-alikes; display names, Reply-To and Sender are ignored);
 *  - the FIRST Authentication-Results header (the one Gmail prepends, authserv-id mx.google.com)
 *    shows dmarc=pass with header.from equal to that domain, or dkim=pass signed by exactly that
 *    domain. Headers an attacker adds further down are never consulted.
 */

export const SENDER_ALLOWLIST: Readonly<Record<ImportKind, { sender: ImportSender; domains: readonly string[] }>> = {
  appliances: { sender: "Bosch", domains: ["bosch-home.co.uk", "bosch-home.com", "bosch.com", "mybosch.com"] },
  readings: { sender: "E.ON", domains: ["eonnext.com", "eon.co.uk", "eonenergy.com"] },
};

/** Gmail search for one kind: allowlisted senders from the last two years. */
export function searchQuery(kind: ImportKind): string {
  return `from:(${SENDER_ALLOWLIST[kind].domains.join(" OR ")}) newer_than:2y`;
}

export interface HeaderList { name?: string; value?: string }

function all(headers: HeaderList[] | undefined, name: string): string[] {
  return (headers ?? []).filter((h) => h.name?.toLowerCase() === name).map((h) => (typeof h.value === "string" ? h.value : ""));
}

/** True when Gmail's own Authentication-Results show DMARC or DKIM passing for exactly `domain`. */
export function authenticatedFor(authResults: string, domain: string): boolean {
  const flat = authResults.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const parts = flat.split(";").map((p) => p.trim());
  if (parts[0] !== "mx.google.com") return false;
  for (const p of parts.slice(1)) {
    if (/^dmarc=pass\b/.test(p)) {
      const from = /\bheader\.from=([^\s;]+)/.exec(p)?.[1];
      if (from === domain) return true;
    }
    if (/^dkim=pass\b/.test(p)) {
      const d = /\bheader\.d=([^\s;]+)/.exec(p)?.[1];
      const i = /\bheader\.i=[^\s;@]*@([^\s;]+)/.exec(p)?.[1];
      if (d === domain || i === domain) return true;
    }
  }
  return false;
}

export type SenderCheck = { ok: true; sender: ImportSender; domain: string } | { ok: false };

export function verifySender(headers: HeaderList[] | undefined, kind: ImportKind): SenderCheck {
  const froms = all(headers, "from");
  if (froms.length !== 1) return { ok: false };
  // Exactly one "@" outside the quoted display name: one mailbox, nothing smuggled beside it.
  const unquoted = froms[0]!.replace(/"(?:[^"\\]|\\.)*"/g, " ");
  if ((unquoted.match(/@/g) ?? []).length !== 1) return { ok: false };
  const addrs = addressParts(froms[0]!);
  if (addrs.length !== 1) return { ok: false };
  const domain = addrs[0]!.domain;
  const rule = SENDER_ALLOWLIST[kind];
  if (!rule.domains.includes(domain)) return { ok: false };
  const auth = all(headers, "authentication-results")[0];
  if (!auth || !authenticatedFor(auth, domain)) return { ok: false };
  return { ok: true, sender: rule.sender, domain };
}
