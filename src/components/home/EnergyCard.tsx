import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { formatDate, type DatePrefs } from "@/components/dates";
import { daysBetween, formatGBP, relativeDays } from "@/components/money/format";
import { period } from "@/components/energy/EnergySections";
import { isEmpty, tariffDate, type EnergyData } from "@/components/energy/group";

/** Null data means loading failed. Shows recorded text only, never a live appliance state. */
export function EnergyCard({ data, today, datePrefs }: { data: EnergyData | null; today: string; datePrefs?: DatePrefs }) {
  const tariff = data?.tariffs.find((t) => tariffDate(t));
  const d = tariff ? tariffDate(tariff) : null;
  const bill = data?.bills[0];
  const solar = data?.solar.find((s) => s.status || s.next_action);
  return (
    <section aria-label="Energy" data-testid="energy-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="bolt" tint="amber">Energy</CardTitle>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        {data === null ? (
          <p className="text-muted">Could not load this right now.</p>
        ) : isEmpty(data) ? (
          <p className="text-muted">No energy figures yet</p>
        ) : (
          <>
            {tariff && d && (
              <p>
                Tariff {tariff.end_date ? "ends" : "renews"} {formatDate(d, datePrefs)}{" "}
                <span className="text-muted">({relativeDays(daysBetween(today, d))})</span>
              </p>
            )}
            {bill && (
              <p>
                Latest bill {formatGBP(bill.amount as number)}
                {period(bill, datePrefs) ? <span className="text-muted"> ({period(bill, datePrefs)})</span> : null}
                {!bill.verified && <span className="text-muted"> Unverified</span>}
              </p>
            )}
            {solar && (
              <p className="break-words">
                Solar: {solar.status ?? solar.next_action} <span className="text-muted">(as recorded)</span>
              </p>
            )}
          </>
        )}
      </div>
      <Link
        href="/energy"
        className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Energy details
      </Link>
    </section>
  );
}
