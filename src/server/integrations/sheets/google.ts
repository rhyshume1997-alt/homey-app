import "server-only";
import { getServerEnv } from "@/server/env";
import { getGoogleAccess, invalidateAccessToken } from "@/server/integrations/google/token";
import { SHEETS_SCOPE } from "@/server/integrations/google/scopes";

/** Read-only Google Sheets access with the signed-in user's own token (scope spreadsheets.readonly, D17). */

export const RANGE = "Sheet1!A1:H40";
const CACHE_MS = 2 * 60_000;
const TIMEOUT_MS = 8_000;

export type SheetsErrorCode = "auth" | "http" | "timeout" | "parse";
const MESSAGES: Record<SheetsErrorCode, string> = {
  auth: "Google no longer accepts the connection.",
  http: "Google Sheets request failed.",
  timeout: "Google Sheets did not respond in time.",
  parse: "Google Sheets returned an unexpected response.",
};
/** Fixed messages only: never includes tokens or response bodies. */
export class SheetsError extends Error {
  constructor(readonly code: SheetsErrorCode) {
    super(MESSAGES[code]);
    this.name = "SheetsError";
  }
}

export type Cell = string | number | boolean | null;
export interface SheetGrid { values: Cell[][]; formulas: Cell[][]; fetchedAt: number; cached?: boolean }
export interface SheetsDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Override the sheet id (default COSTS_SHEET_ID). null = not configured. */
  sheetId?: string | null;
  /** Override the user's Google access (default: the current user's connection). null = not connected. */
  access?: { accessToken: string; userId: string } | null;
}

const grids = new Map<string, SheetGrid>();
export function clearSheetsCache(): void {
  grids.clear();
}

async function timedFetch(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new SheetsError("timeout");
    throw new SheetsError("http");
  } finally {
    clearTimeout(t);
  }
}

async function fetchValues(
  sheetId: string, f: typeof fetch, tok: string, userId: string, render: "UNFORMATTED_VALUE" | "FORMULA",
): Promise<Cell[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(RANGE)}` +
    `?valueRenderOption=${render}&majorDimension=ROWS`;
  const res = await timedFetch(f, url, { headers: { authorization: `Bearer ${tok}` } });
  if (!res.ok) {
    if (res.status === 401) {
      invalidateAccessToken(userId);
      throw new SheetsError("auth");
    }
    throw new SheetsError("http");
  }
  const j = (await res.json().catch(() => null)) as { values?: unknown } | null;
  if (!j) throw new SheetsError("parse");
  if (j.values === undefined) return [];
  if (!Array.isArray(j.values) || !j.values.every(Array.isArray)) throw new SheetsError("parse");
  return j.values as Cell[][];
}

/**
 * The costs sheet grid read with the current user's Google connection, or null when the sheet is
 * not configured or the user is not connected. Cached for 2 minutes per user.
 */
export async function fetchCostsGrid(deps: SheetsDeps = {}): Promise<SheetGrid | null> {
  const sheetId = deps.sheetId === undefined ? (getServerEnv().COSTS_SHEET_ID ?? null) : deps.sheetId;
  if (!sheetId) return null;
  const access = deps.access === undefined ? await getGoogleAccess(SHEETS_SCOPE) : deps.access;
  if (!access) return null;
  const now = (deps.now ?? Date.now)();
  const key = `${access.userId}:${sheetId}`;
  const hit = grids.get(key);
  if (hit && now - hit.fetchedAt < CACHE_MS) return { ...hit, cached: true };
  const f = deps.fetch ?? fetch;
  const [values, formulas] = await Promise.all([
    fetchValues(sheetId, f, access.accessToken, access.userId, "UNFORMATTED_VALUE"),
    fetchValues(sheetId, f, access.accessToken, access.userId, "FORMULA"),
  ]);
  const grid: SheetGrid = { values, formulas, fetchedAt: now };
  grids.set(key, grid);
  return grid;
}
