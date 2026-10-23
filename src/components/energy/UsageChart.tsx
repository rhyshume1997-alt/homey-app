import { formatDate, type DatePrefs } from "@/components/dates";
import type { UsagePeriod } from "./usage";

const NUM = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const FUEL = { electricity: "Electricity", gas: "Gas" } as const;

/** A small SVG bar chart: one bar per period between two consecutive readings, height is use per day. */
export function UsageChart({ periods, datePrefs }: { periods: UsagePeriod[]; datePrefs?: DatePrefs }) {
  if (periods.length === 0) return null;
  const { fuel, unit } = periods[0];
  const max = Math.max(...periods.map((p) => p.perDay), 0);
  const W = 320;
  const H = 120;
  const slot = W / periods.length;
  const bar = Math.min(40, slot * 0.7);
  const title = `${FUEL[fuel]} use per day between readings, in ${unit}`;
  return (
    <figure className="flex flex-col gap-2" data-testid={`usage-chart-${fuel}-${unit}`}>
      <figcaption className="text-sm font-medium">
        {FUEL[fuel]}: average {unit} per day between readings
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={title} className="w-full max-w-md">
        <title>{title}</title>
        <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" strokeOpacity="0.3" />
        {periods.map((p, i) => {
          const h = max > 0 ? (p.perDay / max) * (H - 8) : 0;
          return (
            <rect
              key={p.to}
              data-testid="usage-bar"
              x={i * slot + (slot - bar) / 2}
              y={H - h}
              width={bar}
              height={h}
              rx="2"
              className="fill-accent"
            >
              <title>{`${formatDate(p.from, datePrefs)} to ${formatDate(p.to, datePrefs)}: ${NUM.format(p.perDay)} ${unit} per day`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">Between readings</th>
              <th scope="col" className="py-1 pr-3 font-medium">Used</th>
              <th scope="col" className="py-1 font-medium">Per day</th>
            </tr>
          </thead>
          <tbody>
            {[...periods].reverse().map((p) => (
              <tr key={p.to} data-testid="usage-row" className="border-t border-border">
                <td className="py-1 pr-3">
                  {formatDate(p.from, datePrefs)} to {formatDate(p.to, datePrefs)} ({p.days} {p.days === 1 ? "day" : "days"})
                </td>
                <td className="whitespace-nowrap py-1 pr-3">{NUM.format(p.used)} {unit}</td>
                <td className="whitespace-nowrap py-1">{NUM.format(p.perDay)} {unit}/day</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
