import "server-only";
import { fetchCostsGrid, SheetsError, type SheetsDeps } from "./google";
import { parseCosts, reconcile, type CostsSheet, type Flag } from "./costs";
import { getSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";

export type CostsResult =
  | { status: "off" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      sheet: CostsSheet;
      flags: Flag[];
      fetchedAt: number;
      /** true: read from Google just now with the viewer's own connection. false: last saved snapshot. */
      live: boolean;
      /** Display name of who refreshed the snapshot (snapshots only). */
      fetchedBy?: string | null;
    };

export interface SnapshotRow { data: unknown; fetchedAt: number; fetchedBy: string | null }
export interface SnapshotStore {
  load(): Promise<SnapshotRow | null>;
  save(householdId: string, data: { sheet: CostsSheet; flags: Flag[] }): Promise<void>;
}
export interface LoadDeps extends SheetsDeps {
  session?: { householdId: string } | null;
  snapshots?: SnapshotStore;
}

export const dbSnapshots: SnapshotStore = {
  async load() {
    const db = await createUserClient();
    if (!db) return null;
    const { data } = await db.from("budget_snapshots").select("data, fetched_at, fetched_by").limit(1).maybeSingle();
    if (!data) return null;
    let name: string | null = null;
    if (data.fetched_by) {
      const m = await db.from("household_members").select("display_name").eq("user_id", data.fetched_by).limit(1).maybeSingle();
      name = m.data?.display_name ?? null;
    }
    return { data: data.data, fetchedAt: new Date(data.fetched_at).getTime(), fetchedBy: name };
  },
  async save(householdId, data) {
    const db = await createUserClient();
    if (!db) return;
    await db.from("budget_snapshots").upsert({ household_id: householdId, data }, { onConflict: "household_id" });
  },
};

/** Defensive shape check: a stored snapshot is re-reconciled, never trusted blindly. */
function sheetFromSnapshot(data: unknown): CostsSheet | null {
  const s = (data as { sheet?: CostsSheet } | null)?.sheet;
  if (!s || !Array.isArray(s.bills) || typeof s.summary !== "object" || s.summary === null) return null;
  return s;
}

async function snapshotResult(store: SnapshotStore): Promise<CostsResult | null> {
  const snap = await store.load().catch(() => null);
  const sheet = snap ? sheetFromSnapshot(snap.data) : null;
  if (!snap || !sheet) return null;
  return { status: "ok", sheet, flags: reconcile(sheet), fetchedAt: snap.fetchedAt, live: false, fetchedBy: snap.fetchedBy };
}

/**
 * Connected viewer: read the sheet live and save a snapshot for the household.
 * Otherwise: the household's latest snapshot, or "off".
 */
export async function loadCosts(deps: LoadDeps = {}): Promise<CostsResult> {
  const store = deps.snapshots ?? dbSnapshots;
  const session = deps.session === undefined ? await getSession() : deps.session;
  if (!session) return { status: "off" };
  try {
    const grid = await fetchCostsGrid(deps);
    if (grid) {
      const sheet = parseCosts(grid.values, grid.formulas);
      const flags = reconcile(sheet);
      if (!grid.cached) await store.save(session.householdId, { sheet, flags }).catch(() => undefined);
      return { status: "ok", sheet, flags, fetchedAt: grid.fetchedAt, live: true };
    }
  } catch (e) {
    const snap = await snapshotResult(store);
    if (snap) return snap;
    return { status: "error", message: e instanceof SheetsError ? e.message : "Could not read the costs sheet." };
  }
  return (await snapshotResult(store)) ?? { status: "off" };
}
