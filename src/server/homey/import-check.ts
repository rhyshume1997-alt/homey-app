import "server-only";
import type { NeedItem } from "@/components/homey/types";
import type { CandidateCounts, SaverSession } from "@/contracts/email-import";
import { importSavers } from "@/server/integrations/gmail-import/savers";
import { describeCandidates, findImportCandidates, type ImportDeps } from "@/server/integrations/gmail-import/service";

/** Homey must never wait on Gmail: past this the check is dropped and the panel shows without it. */
export const IMPORT_CHECK_TIMEOUT_MS = 2_500;

type Finder = (s: SaverSession, deps: ImportDeps) => Promise<CandidateCounts>;

/**
 * One optional "check" item when the member's own Gmail has allowlisted emails that are not yet
 * saved. Counts only: no sender, subject or body reaches Homey. Never throws and never takes longer
 * than `timeoutMs`; any failure, timeout or "not connected" gives null.
 */
export async function importCheckItem(
  session: SaverSession,
  opts: { timeoutMs?: number; find?: Finder } = {},
): Promise<NeedItem | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, opts.timeoutMs ?? IMPORT_CHECK_TIMEOUT_MS);
  });
  // Abort in-flight Gmail requests once we stop waiting, so nothing keeps running in the background.
  const boundFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, ctl.signal]) : ctl.signal });
  const work = (async () => {
    const find: Finder = opts.find ?? ((s, d) => findImportCandidates(s, { ...d, savers: importSavers() }));
    const c = await find(session, { fetch: boundFetch });
    const text = describeCandidates(c);
    if (!text || c.status !== "ok") return null;
    const href = c.appliances > 0 ? "/import/appliances" : "/import/readings";
    const item: NeedItem = {
      key: "import:email",
      bucket: "check",
      kind: "figures",
      light: "green",
      text,
      href,
      action: { type: "open", href, label: "Review import" },
    };
    return item;
  })().catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
