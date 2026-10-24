import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSheetsCache, fetchCostsGrid } from "./google";
import { loadCosts, type SnapshotStore } from "./load";
import fixture from "../../../../tests/fixtures/costs-sheet.json";

const SHEET = "1D8UbD8WUOiW7h64yd7rwfaAEVFRPBx1tyBJtc7jxHhQ";
const access = { accessToken: "user-tok", userId: "u1" };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
function mockFetch() {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("valueRenderOption=FORMULA")) return json({ values: fixture.formulas });
    if (u.includes("valueRenderOption=UNFORMATTED_VALUE")) return json({ values: fixture.values });
    return json({}, 404);
  });
}
const asFetch = (f: unknown) => f as typeof fetch;

function memoryStore(initial: Awaited<ReturnType<SnapshotStore["load"]>> = null) {
  let row = initial;
  const save = vi.fn(async (_h: string, data: { sheet: unknown; flags: unknown[] }) => {
    row = { data, fetchedAt: 5000, fetchedBy: "Alex" };
  });
  const load = vi.fn(async (_h: string) => row);
  const store: SnapshotStore = { load, save };
  return { store, save, load };
}
const session = { householdId: "h1" };

beforeEach(() => clearSheetsCache());

describe("fetchCostsGrid", () => {
  it("returns null when the sheet is unset or the user is not connected, without any request", async () => {
    const f = mockFetch();
    expect(await fetchCostsGrid({ sheetId: null, access, fetch: asFetch(f) })).toBeNull();
    expect(await fetchCostsGrid({ sheetId: SHEET, access: null, fetch: asFetch(f) })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches values and formulas with the user's bearer token, GET only", async () => {
    const f = mockFetch();
    const g = await fetchCostsGrid({ sheetId: SHEET, access, fetch: asFetch(f), now: () => 1000 });
    expect(g?.values[1]![0]).toBe("Mortgage");
    expect(g?.formulas).toEqual(fixture.formulas);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith("https://sheets.googleapis.com/v4/spreadsheets/"))).toBe(true);
    expect(urls.some((u) => u.includes("valueRenderOption=UNFORMATTED_VALUE"))).toBe(true);
    expect(urls.some((u) => u.includes("valueRenderOption=FORMULA"))).toBe(true);
    for (const c of f.mock.calls) {
      expect(((c[1] as RequestInit).headers as Record<string, string>).authorization).toBe("Bearer user-tok");
      expect((c[1] as RequestInit).method).toBeUndefined();
    }
  });

  it("caches for 2 minutes per user", async () => {
    const f = mockFetch();
    let t = 0;
    const deps = { sheetId: SHEET, access, fetch: asFetch(f), now: () => t };
    await fetchCostsGrid(deps);
    t = 60_000;
    expect((await fetchCostsGrid(deps))?.cached).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    t = 2 * 60_000 + 1;
    await fetchCostsGrid(deps);
    expect(f).toHaveBeenCalledTimes(4);
    await fetchCostsGrid({ ...deps, access: { accessToken: "x", userId: "u2" } });
    expect(f).toHaveBeenCalledTimes(6);
  });

  it("maps failures to fixed errors", async () => {
    const f401 = vi.fn(async () => json({ error: "secret detail" }, 401));
    await expect(fetchCostsGrid({ sheetId: SHEET, access, fetch: asFetch(f401) })).rejects.toMatchObject({ code: "auth" });
    const f403 = vi.fn(async () => json({}, 403));
    await expect(fetchCostsGrid({ sheetId: SHEET, access, fetch: asFetch(f403) })).rejects.toMatchObject({ code: "http", message: "Google Sheets request failed." });
    const bad = vi.fn(async () => json({ values: "nope" }));
    await expect(fetchCostsGrid({ sheetId: SHEET, access, fetch: asFetch(bad) })).rejects.toMatchObject({ code: "parse" });
  });

  it("times out", async () => {
    vi.useFakeTimers();
    try {
      const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, rej) => {
        init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })));
      }));
      const p = fetchCostsGrid({ sheetId: SHEET, access, fetch: asFetch(hang) });
      const assertion = expect(p).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(9_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadCosts", () => {
  it("connected: reads live, reconciles and saves a snapshot", async () => {
    const { store, save } = memoryStore();
    const res = await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(mockFetch()), now: () => 1234, snapshots: store });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.live).toBe(true);
      expect(res.fetchedAt).toBe(1234);
      expect(res.sheet.bills).toHaveLength(11);
      expect(res.flags.length).toBeGreaterThan(0);
    }
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe("h1");
  });

  it("does not save again for a cached read", async () => {
    const { store, save } = memoryStore();
    const deps = { sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(mockFetch()), now: () => 10, snapshots: store };
    await loadCosts(deps);
    await loadCosts(deps);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("not connected: returns the household snapshot, not live", async () => {
    const live = memoryStore();
    await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(mockFetch()), snapshots: live.store });
    const f = mockFetch();
    const res = await loadCosts({ sheetId: SHEET, access: null, session, primaryHouseholdId: "h1", fetch: asFetch(f), snapshots: live.store });
    expect(f).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "ok", live: false, fetchedAt: 5000, fetchedBy: "Alex" });
    if (res.status === "ok") expect(res.flags.length).toBeGreaterThan(0);
  });

  it("not connected and no snapshot: off; no session: off", async () => {
    expect(await loadCosts({ sheetId: SHEET, access: null, session, primaryHouseholdId: "h1", snapshots: memoryStore().store })).toEqual({ status: "off" });
    expect(await loadCosts({ session: null })).toEqual({ status: "off" });
  });

  it("another household, or an unset PRIMARY_HOUSEHOLD_ID: off, nothing read, nothing saved or loaded", async () => {
    for (const primaryHouseholdId of ["other-household", null]) {
      const { store, save, load } = memoryStore();
      const f = mockFetch();
      const res = await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId, fetch: asFetch(f), snapshots: store });
      expect(res).toEqual({ status: "off" });
      expect(f).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("loads the snapshot for the session household", async () => {
    const { store, load } = memoryStore();
    await loadCosts({ sheetId: SHEET, access: null, session, primaryHouseholdId: "h1", snapshots: store });
    expect(load).toHaveBeenCalledWith("h1");
  });

  it("a malformed snapshot is ignored", async () => {
    const { store } = memoryStore({ data: { sheet: 5 }, fetchedAt: 1, fetchedBy: null });
    expect(await loadCosts({ sheetId: SHEET, access: null, session, primaryHouseholdId: "h1", snapshots: store })).toEqual({ status: "off" });
  });

  it("live failure falls back to the snapshot, or reports a fixed error", async () => {
    const f403 = vi.fn(async () => json({}, 403));
    const withSnap = memoryStore();
    await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(mockFetch()), snapshots: withSnap.store });
    clearSheetsCache();
    expect(await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(f403), snapshots: withSnap.store })).toMatchObject({ status: "ok", live: false });
    clearSheetsCache();
    expect(await loadCosts({ sheetId: SHEET, access, session, primaryHouseholdId: "h1", fetch: asFetch(f403), snapshots: memoryStore().store })).toEqual({
      status: "error",
      message: "Google Sheets request failed.",
    });
  });
});
