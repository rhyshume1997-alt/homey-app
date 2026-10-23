import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApplianceSaver, ConfirmedAppliance, ConfirmedReading, ReadingSaver } from "@/contracts/email-import";
import { GMAIL_SCOPE, SHEETS_SCOPE } from "@/server/integrations/google/scopes";
import { authenticatedFor, searchQuery, verifySender } from "./senders";
import {
  IMPORT_MSG, describeCandidates, findImportCandidates, listApplianceDrafts, listReadingDrafts, saveApplianceFromEmail,
  saveReadingFromEmail,
} from "./service";

// Synthetic messages only. Real Google APIs are never called: fetch is mocked.

const SESSION = { userId: "u-1", householdId: "h-1" };
const ACCESS = { accessToken: "at-test", scopes: `${SHEETS_SCOPE} ${GMAIL_SCOPE}`, userId: "u-1" };
const NOW = Date.UTC(2026, 9, 22, 12);
const SENTINEL = "BODY-SENTINEL-7f3a";

const authOk = (d: string) =>
  `mx.google.com; dkim=pass header.i=@${d} header.s=s1 header.b=abc; spf=pass (google.com: domain of x@${d}) smtp.mailfrom=x@${d}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${d}`;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

interface Msg { id: string; from: string; auth?: string | null; extraHeaders?: { name: string; value: string }[]; subject: string; body: string; at?: number }
function full(m: Msg) {
  const headers = [
    ...(m.auth === null ? [] : [{ name: "Authentication-Results", value: m.auth ?? authOk(m.from.split("@")[1]!.replace(/>.*$/, "")) }]),
    { name: "From", value: m.from },
    { name: "Subject", value: m.subject },
    ...(m.extraHeaders ?? []),
  ];
  return {
    id: m.id,
    internalDate: String(m.at ?? Date.UTC(2024, 10, 15, 10)),
    payload: { mimeType: "multipart/alternative", headers, parts: [{ mimeType: "text/plain", body: { data: b64(m.body) } }] },
  };
}

function gmail(messages: Msg[]) {
  const byId = new Map(messages.map((m) => [m.id, full(m)]));
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer at-test");
    const u = new URL(url);
    expect(u.origin).toBe("https://gmail.googleapis.com");
    if (u.pathname === "/gmail/v1/users/me/messages") {
      return new Response(JSON.stringify({ messages: messages.map((m) => ({ id: m.id })) }));
    }
    const id = u.pathname.split("/").pop()!;
    expect(u.searchParams.get("format")).toBe("full");
    const m = byId.get(id);
    return m ? new Response(JSON.stringify(m)) : new Response("{}", { status: 404 });
  });
  return f;
}

const BOSCH_BODY = `Thank you for your order\nOrder date: 14/11/2024\nProduct: Series 6 dishwasher\nE-Nr.: SMS6ZCI49E/01\n2 year guarantee\n${SENTINEL}`;
const EON_BODY = `Thanks, we've received your readings.\nReading date: 1 October 2026\nElectricity reading: 12345\nGas reading: 4321 m3\n${SENTINEL}`;
const bosch = (o: Partial<Msg> = {}): Msg => ({ id: "18c2fa0001", from: "Bosch Home <orders@bosch-home.co.uk>", subject: "Your order confirmation", body: BOSCH_BODY, ...o });
const eon = (o: Partial<Msg> = {}): Msg => ({ id: "18c2fb0001", from: "E.ON Next <hello@eonnext.com>", subject: "Meter readings received", body: EON_BODY, at: Date.UTC(2026, 9, 1, 18), ...o });

describe("sender allowlist and authentication", () => {
  it("search query lists the exact allowlisted domains, two years", () => {
    expect(searchQuery("appliances")).toBe("from:(bosch-home.co.uk OR bosch-home.com OR bosch.com OR mybosch.com) newer_than:2y");
    expect(searchQuery("readings")).toBe("from:(eonnext.com OR eon.co.uk OR eonenergy.com) newer_than:2y");
  });

  const h = (from: string, auth: string | null, extra: { name: string; value: string }[] = []) =>
    [...(auth ? [{ name: "Authentication-Results", value: auth }] : []), { name: "From", value: from }, ...extra];

  it("accepts an exact domain with Gmail's dmarc=pass, or dkim=pass for that domain", () => {
    expect(verifySender(h("orders@bosch-home.co.uk", authOk("bosch-home.co.uk")), "appliances")).toEqual({ ok: true, sender: "Bosch", domain: "bosch-home.co.uk" });
    expect(verifySender(h("x@bosch.com", "mx.google.com; dkim=pass header.d=bosch.com; dmarc=fail header.from=bosch.com"), "appliances").ok).toBe(true);
    expect(verifySender(h("x@eonnext.com", authOk("eonnext.com")), "readings").ok).toBe(true);
  });

  it("rejects subdomains, look-alikes, wrong kind and display-name tricks", () => {
    for (const from of [
      "x@mail.bosch-home.co.uk", "x@bosch-home.co.uk.evil.com", "x@evil-bosch.com", "x@b0sch.com",
      '"orders@bosch-home.co.uk" <attacker@evil.com>', "Bosch <attacker@evil.com>",
      "orders@bosch-home.co.uk, attacker@evil.com", "Bosch <orders@bosch-home.co.uk>, attacker@evil.com",
    ]) {
      const d = from.match(/@([a-z0-9.-]+)>?$/i)?.[1] ?? "evil.com";
      expect(verifySender(h(from, authOk(d)), "appliances").ok, from).toBe(false);
    }
    expect(verifySender(h("x@eonnext.com", authOk("eonnext.com")), "appliances").ok).toBe(false);
  });

  it("ignores Reply-To; requires Gmail's own first Authentication-Results to pass for that domain", () => {
    expect(verifySender(h("x@evil.com", authOk("evil.com"), [{ name: "Reply-To", value: "x@bosch.com" }]), "appliances").ok).toBe(false);
    expect(verifySender(h("x@bosch.com", null), "appliances").ok).toBe(false);
    expect(verifySender(h("x@bosch.com", "mx.google.com; dkim=fail header.d=bosch.com; dmarc=fail header.from=bosch.com"), "appliances").ok).toBe(false);
    // DKIM passing for another domain does not count.
    expect(verifySender(h("x@bosch.com", "mx.google.com; dkim=pass header.d=evil.com; dmarc=none header.from=bosch.com"), "appliances").ok).toBe(false);
    // A forged header from another server, or one placed below Gmail's, is not trusted.
    expect(verifySender(h("x@bosch.com", authOk("bosch.com").replace("mx.google.com", "evil.example")), "appliances").ok).toBe(false);
    const forged = [
      { name: "Authentication-Results", value: "mx.google.com; dmarc=fail header.from=bosch.com" },
      { name: "Authentication-Results", value: authOk("bosch.com") },
      { name: "From", value: "x@bosch.com" },
    ];
    expect(verifySender(forged, "appliances").ok).toBe(false);
    // Comments cannot smuggle a pass.
    expect(authenticatedFor("mx.google.com; dmarc=fail (dmarc=pass header.from=bosch.com) header.from=bosch.com", "bosch.com")).toBe(false);
    // Two From headers are rejected.
    expect(verifySender([...h("x@bosch.com", authOk("bosch.com")), { name: "From", value: "y@evil.com" }], "appliances").ok).toBe(false);
  });
});

describe("listing drafts", () => {
  it("not connected, other user's token or missing gmail.readonly -> not_connected, no Gmail calls", async () => {
    const f = gmail([bosch()]);
    for (const access of [null, { ...ACCESS, userId: "u-2" }, { ...ACCESS, scopes: SHEETS_SCOPE }]) {
      expect(await listApplianceDrafts(SESSION, { access, fetch: f as unknown as typeof fetch })).toEqual({ status: "not_connected" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("returns drafts for verified senders only, without the body", async () => {
    const f = gmail([
      bosch(),
      bosch({ id: "18c2fa0002", from: "Bosch <orders@bosch-home.co.uk.evil.com>" }),
      bosch({ id: "18c2fa0003", auth: "mx.google.com; dkim=fail; dmarc=fail header.from=bosch-home.co.uk" }),
      bosch({ id: "18c2fa0004", subject: "Autumn offers", body: "Save on dishwashers" }),
    ]);
    const r = await listApplianceDrafts(SESSION, { access: ACCESS, fetch: f as unknown as typeof fetch });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.drafts).toHaveLength(1);
    const d = r.drafts[0]!;
    expect(d.messageId).toBe("18c2fa0001");
    expect(d.source).toEqual({
      sender: "Bosch", domain: "bosch-home.co.uk", receivedAt: "2024-11-15T10:00:00.000Z", subject: "Your order confirmation",
      messageHash: createHash("sha256").update("18c2fa0001").digest("hex"),
    });
    expect(d.fields.model).toBe("SMS6ZCI49E/01");
    expect(d.fields.warrantyEnd).toBe("2026-11-14");
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    const listUrl = new URL(f.mock.calls[0]![0] as string);
    expect(listUrl.searchParams.get("q")).toBe(searchQuery("appliances"));
  });

  it("drops already-imported messages using the saver's hashes", async () => {
    const f = gmail([bosch()]);
    const saver: ApplianceSaver = {
      save: vi.fn(),
      importedHashes: async (_s, hs) => new Set(hs),
    };
    const r = await listApplianceDrafts(SESSION, { access: ACCESS, fetch: f as unknown as typeof fetch, saver });
    expect(r).toEqual({ status: "ok", drafts: [] });
  });

  it("Gmail errors become a fixed message; 401 becomes not_connected", async () => {
    const boom = vi.fn(async () => new Response(`secret ${SENTINEL}`, { status: 500 }));
    const r = await listReadingDrafts(SESSION, { access: ACCESS, fetch: boom as unknown as typeof fetch });
    expect(r).toEqual({ status: "error", message: IMPORT_MSG.gmail });
    const unauth = vi.fn(async () => new Response("", { status: 401 }));
    expect(await listReadingDrafts(SESSION, { access: ACCESS, fetch: unauth as unknown as typeof fetch })).toEqual({ status: "not_connected" });
  });

  it("findImportCandidates counts both kinds for Homey", async () => {
    const eonBox = gmail([eon()]);
    const boschBox = gmail([bosch(), bosch({ id: "18c2fa0009" })]);
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const isEon = (u.searchParams.get("q") ?? "").includes("eonnext") || u.pathname.endsWith("/18c2fb0001");
      return (isEon ? eonBox : boschBox)(url, init);
    });
    const c = await findImportCandidates(SESSION, { access: ACCESS, fetch: f as unknown as typeof fetch });
    expect(c).toEqual({ status: "ok", appliances: 2, readings: 1 });
    expect(describeCandidates(c)).toBe("I found 2 appliance emails and 1 meter reading email.");
    expect(describeCandidates({ status: "ok", appliances: 0, readings: 0 })).toBeNull();
    expect(await findImportCandidates(SESSION, { access: null })).toEqual({ status: "not_connected" });
  });
});

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe("saving appliances", () => {
  const saver = () => {
    const saved: ConfirmedAppliance[] = [];
    const s: ApplianceSaver = { save: vi.fn(async (_s, a) => { saved.push(a); return { ok: true as const }; }) };
    return { s, saved };
  };

  it("re-fetches by id and saves the parsed values; untouched fields are not 'edited'", async () => {
    const f = gmail([bosch()]);
    const { s, saved } = saver();
    const r = await saveApplianceFromEmail(SESSION, form({
      messageId: "18c2fa0001", model: "SMS6ZCI49E/01", productName: "Series 6 dishwasher", purchaseDate: "2024-11-14",
      warrantyEnd: "2026-11-14", room: "Kitchen",
      // Not editable: ignored.
      make: "Evil", domain: "evil.com", messageHash: "x", household_id: "h-other",
    }), { access: ACCESS, fetch: f as unknown as typeof fetch, saver: s, now: () => NOW });
    expect(r).toEqual({ ok: true, saved: createHash("sha256").update("18c2fa0001").digest("hex") });
    expect(s.save).toHaveBeenCalledWith({ userId: "u-1", householdId: "h-1" }, expect.anything());
    expect(saved[0]).toEqual({
      make: "Bosch", model: "SMS6ZCI49E/01", productName: "Series 6 dishwasher", purchaseDate: "2024-11-14", warrantyEnd: "2026-11-14",
      warrantyEndSource: "computed", room: "Kitchen",
      source: expect.objectContaining({ sender: "Bosch", domain: "bosch-home.co.uk", edited: false }),
    });
    expect(JSON.stringify(saved)).not.toContain(SENTINEL);
    expect(f.mock.calls.some(([u]) => String(u).includes("/messages/18c2fa0001?format=full"))).toBe(true);
  });

  it("validates edits: bad values refused, edited values labelled", async () => {
    const f = gmail([bosch()]);
    const { s, saved } = saver();
    const deps = { access: ACCESS, fetch: f as unknown as typeof fetch, saver: s, now: () => NOW };
    const base = { messageId: "18c2fa0001", model: "SMS6ZCI49E/01", productName: "", purchaseDate: "2024-11-14", warrantyEnd: "2026-11-14", room: "" };
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, purchaseDate: "2024-02-30" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, model: "<script>" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, room: "Garage" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, messageId: "../../x" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, purchaseDate: "2027-01-01", warrantyEnd: "" }), deps)).toEqual({ error: IMPORT_MSG.future });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, warrantyEnd: "2024-01-01" }), deps)).toEqual({ error: IMPORT_MSG.warrantyOrder });
    expect(await saveApplianceFromEmail(SESSION, form({ ...base, model: "" }), deps)).toEqual({ error: IMPORT_MSG.needThing });
    expect(saved).toHaveLength(0);

    const ok = await saveApplianceFromEmail(SESSION, form({ ...base, warrantyEnd: "2029-11-14", productName: '<b>Dish</b> https://x.y' }), deps);
    expect(ok?.ok).toBe(true);
    expect(saved[0]!.warrantyEndSource).toBe("edited");
    expect(saved[0]!.productName).toBe("Dish");
    expect(saved[0]!.source.edited).toBe(true);
  });

  it("refuses when the email no longer verifies, or with another user's token", async () => {
    const { s } = saver();
    const spoof = gmail([bosch({ from: "orders@evil.com" })]);
    const fd = form({ messageId: "18c2fa0001", model: "SMS6ZCI49E" });
    expect(await saveApplianceFromEmail(SESSION, fd, { access: ACCESS, fetch: spoof as unknown as typeof fetch, saver: s })).toEqual({ error: IMPORT_MSG.gone });
    expect(await saveApplianceFromEmail(SESSION, fd, { access: { ...ACCESS, userId: "u-2" }, saver: s })).toEqual({ error: IMPORT_MSG.notConnected });
    expect(s.save).not.toHaveBeenCalled();
  });

  it("a throwing saver gives a fixed message", async () => {
    const f = gmail([bosch()]);
    const s: ApplianceSaver = { save: async () => { throw new Error(SENTINEL); } };
    const r = await saveApplianceFromEmail(SESSION, form({ messageId: "18c2fa0001", model: "SMS6ZCI49E" }), { access: ACCESS, fetch: f as unknown as typeof fetch, saver: s });
    expect(r).toEqual({ error: IMPORT_MSG.saveFailed });
  });
});

describe("saving readings", () => {
  const saver = () => {
    const saved: ConfirmedReading[] = [];
    const s: ReadingSaver = { save: vi.fn(async (_s, r) => { saved.push(r); return { ok: true as const }; }) };
    return { s, saved };
  };
  const base = { messageId: "18c2fb0001", readingDate: "2026-10-01", elecSingle: "12345", gas: "4321", gasUnit: "m3" };

  it("saves the confirmed values labelled with source and date", async () => {
    const f = gmail([eon()]);
    const { s, saved } = saver();
    const r = await saveReadingFromEmail(SESSION, form(base), { access: ACCESS, fetch: f as unknown as typeof fetch, saver: s, now: () => NOW });
    expect(r?.ok).toBe(true);
    expect(saved[0]).toEqual({
      readingDate: "2026-10-01",
      electricity: [{ register: "single", kwh: 12345 }],
      gas: { value: 4321, unit: "m3" },
      meterType: null,
      source: expect.objectContaining({ sender: "E.ON", domain: "eonnext.com", receivedAt: "2026-10-01T18:00:00.000Z", edited: false }),
    });
  });

  it("requires a date, a reading and a gas unit; rejects bad numbers; marks edits", async () => {
    const f = gmail([eon()]);
    const { s, saved } = saver();
    const deps = { access: ACCESS, fetch: f as unknown as typeof fetch, saver: s, now: () => NOW };
    expect(await saveReadingFromEmail(SESSION, form({ ...base, readingDate: "" }), deps)).toEqual({ error: IMPORT_MSG.needDate });
    expect(await saveReadingFromEmail(SESSION, form({ ...base, elecSingle: "", gas: "" }), deps)).toEqual({ error: IMPORT_MSG.needReading });
    expect(await saveReadingFromEmail(SESSION, form({ ...base, gasUnit: "" }), deps)).toEqual({ error: IMPORT_MSG.needUnit });
    expect(await saveReadingFromEmail(SESSION, form({ ...base, elecSingle: "-5" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveReadingFromEmail(SESSION, form({ ...base, elecSingle: "1e9" }), deps)).toEqual({ error: IMPORT_MSG.invalid });
    expect(await saveReadingFromEmail(SESSION, form({ ...base, readingDate: "2026-12-01" }), deps)).toEqual({ error: IMPORT_MSG.future });
    expect(saved).toHaveLength(0);
    expect((await saveReadingFromEmail(SESSION, form({ ...base, elecSingle: "12346" }), deps))?.ok).toBe(true);
    expect(saved[0]!.source.edited).toBe(true);
  });
});
