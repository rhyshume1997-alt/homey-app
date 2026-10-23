const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export function SpendMeter({ spentPence, capGbp }: { spentPence: number | null; capGbp: number }) {
  const cap = Math.round(capGbp * 100);
  if (spentPence === null) {
    return (
      <p data-testid="ai-spend" className="text-sm text-muted">
        Spend this month could not be loaded. Limit {gbp(cap)}.
      </p>
    );
  }
  const pct = cap > 0 ? Math.min(100, Math.round((spentPence / cap) * 100)) : 100;
  return (
    <div data-testid="ai-spend" className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label="AI spend this month"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${gbp(spentPence)} of ${gbp(cap)}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted">
        {gbp(spentPence)} of {gbp(cap)}
      </p>
    </div>
  );
}

export function AssistantOff() {
  return (
    <section aria-label="Assistant is off" className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Assistant is off</h2>
      <p className="mt-2 text-sm">
        To turn it on, create an Anthropic API key, set a monthly spend limit in the Anthropic console, and add it as
        ANTHROPIC_API_KEY in the app settings on Vercel. The suggestions on the home page work without it.
      </p>
    </section>
  );
}
