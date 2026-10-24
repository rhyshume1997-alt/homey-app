export function SetupCard() {
  return (
    <section aria-label="Connect the costs sheet" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Costs sheet not connected yet</h2>
      <p className="mt-2 text-sm text-muted">
        Our Home reads the sheet with your own Google sign-in. The connection is read-only and nothing is shared with a service account.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          The household owner (once): in Vercel, set <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> (the same values as the
          Google provider in Supabase), <code>GOOGLE_TOKEN_ENCRYPTION_KEY</code> and <code>COSTS_SHEET_ID</code> (the ID in the sheet URL),
          then redeploy.
        </li>
        <li>Open Google connection and choose Connect Google. Tick both read-only boxes on the Google screen.</li>
        <li>Come back to this page. Whenever someone who is connected opens it, the latest figures are saved for the other person to see.</li>
      </ol>
      <a href="/settings/google" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Connect Google
      </a>
    </section>
  );
}

export function SheetError({ message }: { message: string }) {
  return (
    <section aria-label="Costs sheet unavailable" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Could not read the costs sheet</h2>
      <p className="mt-2 text-sm text-muted">{message} Check your Google connection, then try again in a few minutes.</p>
      <a href="/settings/google" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2">
        Google connection
      </a>
    </section>
  );
}
