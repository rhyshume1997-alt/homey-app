import { GMAIL_SCOPE, SHEETS_SCOPE, hasScope } from "@/server/integrations/google/scopes";
import { BTN_DANGER, BTN_PRIMARY } from "@/components/tasks/styles";

export type GoogleConnection = { connected: boolean; scopes: string; updatedAt: string | null };

const NOTICES: Record<string, { text: string; error: boolean }> = {
  connected: { text: "Google is connected (read-only).", error: false },
  disconnected: { text: "Google is disconnected and the stored connection was deleted.", error: false },
  cancelled: { text: "Connecting was cancelled. Nothing changed.", error: true },
  failed: { text: "Could not connect Google. Please try again.", error: true },
  scopes: { text: "Google did not grant access to the sheet or to Gmail. Tick both boxes on the Google screen and try again.", error: true },
  no_refresh_token: { text: "Google did not give a lasting connection. Please try again.", error: true },
  unconfigured: { text: "Google connection is not set up on the server yet (the household owner needs to add the settings).", error: true },
};

export function noticeFor(params: { connected?: string; disconnected?: string; error?: string }) {
  if (params.error && NOTICES[params.error]?.error) return NOTICES[params.error]!;
  if (params.connected) return NOTICES.connected!;
  if (params.disconnected) return NOTICES.disconnected!;
  return null;
}

export function GoogleStatus({
  connection, notice, disconnect, timeZoneLabel,
}: {
  connection: GoogleConnection;
  notice: { text: string; error: boolean } | null;
  disconnect: () => Promise<void>;
  timeZoneLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p role={notice.error ? "alert" : "status"} className="rounded-md border border-border bg-surface-muted px-4 py-3 text-sm font-medium">
          {notice.text}
        </p>
      ) : null}

      <section aria-label="Google connection" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold">Your Google connection</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Connected</dt>
          <dd data-testid="connected">{connection.connected ? "Yes" : "No"}</dd>
          {connection.connected ? (
            <>
              <dt className="text-muted">Access</dt>
              <dd data-testid="scopes">
                {[
                  hasScope(connection.scopes, SHEETS_SCOPE) ? "Read the costs sheet" : null,
                  hasScope(connection.scopes, GMAIL_SCOPE) ? "Read Gmail (metadata used)" : null,
                ].filter(Boolean).join(", ") || "None"}
              </dd>
              <dt className="text-muted">Connected at</dt>
              <dd>{connection.updatedAt ? `${connection.updatedAt}${timeZoneLabel ? ` ${timeZoneLabel}` : ""}` : "unknown"}</dd>
            </>
          ) : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/auth/google/connect" className={`${BTN_PRIMARY} inline-flex items-center`}>
            {connection.connected ? "Reconnect Google" : "Connect Google"}
          </a>
          {connection.connected ? (
            <form action={disconnect}>
              <button type="submit" className={BTN_DANGER}>Disconnect</button>
            </form>
          ) : null}
        </div>
      </section>

      <section aria-label="What read-only means" className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="text-base font-semibold">What this allows</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Read-only. Our Home can read the costs sheet and look at Gmail thread headers. It cannot edit the sheet, send, delete or label email, or move money.</li>
          <li>From Gmail it keeps only the subject, the company domain, dates and who wrote last. Message text and email addresses are never stored.</li>
          <li>Your connection is stored encrypted and only your own sign-in can use it. Other members of your household cannot see your Gmail data beyond those awaiting-reply entries.</li>
          <li>Disconnect any time: the stored connection is deleted and access is revoked at Google.</li>
        </ul>
      </section>
    </div>
  );
}
