import Link from "next/link";
import { formatDate, type DatePrefs } from "@/components/dates";
import { ActionButton } from "@/components/shopping/ActionButton";
import type { FormAction } from "@/components/tasks/types";
import type { MeterFuel, MeterReading, MeterUnit } from "@/contracts/meter-readings";
import { ReadingForm } from "./ReadingForm";
import { UsageChart } from "./UsageChart";
import { computeUsage } from "./usage";

const NUM = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });
const FUEL_LABEL: Record<MeterFuel, string> = { electricity: "Electricity", gas: "Gas" };

export const NEED_TWO = "Add at least two readings to see usage";

function groups(readings: MeterReading[]): Array<{ fuel: MeterFuel; unit: MeterUnit; rs: MeterReading[] }> {
  const out: Array<{ fuel: MeterFuel; unit: MeterUnit; rs: MeterReading[] }> = [];
  for (const r of readings) {
    let g = out.find((x) => x.fuel === r.fuel && x.unit === r.unit);
    if (!g) out.push((g = { fuel: r.fuel, unit: r.unit, rs: [] }));
    g.rs.push(r);
  }
  return out.sort((a, b) => (a.fuel + a.unit).localeCompare(b.fuel + b.unit));
}

export function ReadingsSection({
  readings,
  today,
  datePrefs,
  actions,
}: {
  readings: MeterReading[] | null;
  today: string;
  datePrefs?: DatePrefs;
  actions: { add: FormAction; remove: FormAction };
}) {
  const body = () => {
    if (readings === null) return <p className="text-sm text-muted">Could not load this right now.</p>;
    const gs = groups(readings);
    const charts = gs.map((g) => ({ g, u: computeUsage(g.rs, g.fuel) })).filter((x) => x.u.periods.length > 0);
    const skipped = gs.reduce((n, g) => n + computeUsage(g.rs, g.fuel).skipped, 0);
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold">Usage from your readings</h3>
          <p className="mt-1 text-xs text-muted">
            Worked out only from the difference between two consecutive readings you entered, averaged per day. Nothing is
            estimated and gaps between readings are not filled.
          </p>
          {charts.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{NEED_TWO}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {charts.map(({ g, u }) => (
                <UsageChart key={g.fuel + g.unit} periods={u.periods} datePrefs={datePrefs} />
              ))}
            </div>
          )}
          {skipped > 0 && (
            <p className="mt-2 text-xs text-muted">
              {skipped} {skipped === 1 ? "pair of readings was" : "pairs of readings were"} left out because the later
              reading was lower, or on the same day. Check the readings below.
            </p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Readings</h3>
          {readings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No readings yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {readings.map((r) => (
                <li key={r.id} data-testid="reading-row" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="break-words">
                      <strong>{FUEL_LABEL[r.fuel]}</strong>: {NUM.format(r.value)} {r.unit} on {formatDate(r.read_on, datePrefs)}
                    </p>
                    <p className="text-xs text-muted">
                      {r.source === "email" ? "From an email you confirmed" : "Entered by hand"}
                      {r.note ? `. ${r.note}` : ""}
                    </p>
                  </div>
                  <ActionButton
                    action={actions.remove}
                    id={r.id}
                    label="Remove"
                    variant="danger"
                    ariaLabel={`Remove ${FUEL_LABEL[r.fuel]} reading from ${formatDate(r.read_on, datePrefs)}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Add a reading</h3>
          <ReadingForm action={actions.add} today={today} />
        </div>
      </div>
    );
  };
  return (
    <section aria-label="Readings" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Readings</h2>
        <Link href="/import/readings" className="inline-flex min-h-[var(--touch-target)] items-center text-sm font-medium text-accent underline underline-offset-2">Import readings from email</Link>
      </div>
      <div className="mt-3">{body()}</div>
    </section>
  );
}
