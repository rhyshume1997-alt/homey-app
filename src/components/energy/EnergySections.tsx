import type { ReactNode } from "react";
import { formatDate, type DatePrefs } from "@/components/dates";
import { daysBetween, formatGBP, relativeDays } from "@/components/money/format";
import type { HouseholdRecord } from "@/contracts/records";
import { isEmpty, tariffDate, usageLabel, type EnergyData } from "./group";

const KWH = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
export const formatKwh = (n: number) => `${KWH.format(n)} kWh`;

export function period(r: Pick<HouseholdRecord, "start_date" | "end_date">, prefs?: DatePrefs): string | null {
  if (r.start_date && r.end_date) return `${formatDate(r.start_date, prefs)} to ${formatDate(r.end_date, prefs)}`;
  if (r.end_date) return `to ${formatDate(r.end_date, prefs)}`;
  if (r.start_date) return `from ${formatDate(r.start_date, prefs)}`;
  return null;
}

/** Source text and verification state shown with every figure. */
export function Provenance({ r }: { r: Pick<HouseholdRecord, "source" | "verified"> }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="break-words">Source: {r.source ?? "not recorded"}</span>
      {!r.verified && (
        <span className="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 font-medium text-warning-fg">
          Unverified
        </span>
      )}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
const None = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;
const Tag = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">{children}</span>
);
const Item = ({ children }: { children: ReactNode }) => (
  <li className="rounded-md bg-surface-muted px-3 py-3 text-sm">{children}</li>
);

/** A figure with its unit and kind, kWh and pounds kept apart. */
function Figure({ r }: { r: HouseholdRecord }) {
  if (r.amount === null) return null;
  if (r.unit === "kWh") {
    return (
      <p className="mt-1">
        {formatKwh(r.amount)}
        {r.amount_kind ? ` (${usageLabel(r.amount_kind)})` : ""}
      </p>
    );
  }
  if (r.unit === "GBP") {
    return (
      <p className="mt-1">
        {formatGBP(r.amount)}
        {r.amount_kind ? ` (${r.amount_kind})` : ""}
      </p>
    );
  }
  return null;
}

export function EnergySections({
  data,
  today,
  datePrefs,
}: {
  data: EnergyData | null;
  today: string;
  datePrefs?: DatePrefs;
}) {
  if (data === null) return <p className="text-sm text-muted">Could not load this right now.</p>;
  if (isEmpty(data)) return <p className="text-sm text-muted">No energy figures imported yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Tariff">
        {data.tariffs.length === 0 ? (
          <None>No tariff recorded.</None>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.tariffs.map((r) => {
              const d = tariffDate(r);
              const n = d ? daysBetween(today, d) : null;
              return (
                <Item key={r.id}>
                  <p className="break-words">
                    {r.provider && <strong>{r.provider}: </strong>}
                    {r.title}
                  </p>
                  {d && n !== null && (
                    <p className="mt-1">
                      {r.end_date ? "Fixed deal ends" : "Renews"} {formatDate(d, datePrefs)},{" "}
                      {n >= 0 ? `${n} ${n === 1 ? "day" : "days"}` : relativeDays(n)}
                    </p>
                  )}
                  {r.next_action && <p className="mt-1 break-words">Next: {r.next_action}</p>}
                  <Provenance r={r} />
                </Item>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Bills">
        {data.bills.length === 0 ? (
          <None>No bills recorded.</None>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Amount</th>
                  <th scope="col" className="py-2 font-medium">Kind</th>
                </tr>
              </thead>
              <tbody>
                {data.bills.map((r) => (
                  <tr key={r.id} data-testid="bill-row" className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      {period(r, datePrefs) ?? "Period not recorded"}
                      <Provenance r={r} />
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{formatGBP(r.amount as number)}</td>
                    <td className="py-2">Bill</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Usage">
        {data.usage.length === 0 ? (
          <None>No usage figures recorded.</None>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.usage.map((r) => (
              <Item key={r.id}>
                <p className="flex flex-wrap items-center gap-2">
                  <strong>{formatKwh(r.amount as number)}</strong>
                  <Tag>{usageLabel(r.amount_kind)}</Tag>
                </p>
                <p className="mt-1 break-words">
                  {r.title}
                  {period(r, datePrefs) ? `, ${period(r, datePrefs)}` : ""}
                </p>
                <Provenance r={r} />
              </Item>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Solar">
        {data.solar.length === 0 ? (
          <None>No solar details recorded.</None>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.solar.map((r) => (
              <Item key={r.id}>
                <p className="break-words">
                  {r.provider && <strong>{r.provider}: </strong>}
                  {r.title}
                </p>
                {r.unit === "kWh" && r.amount !== null ? (
                  <p className="mt-1">
                    {r.amount_kind === "estimate" ? "Estimated annual generation" : "Generation"} {formatKwh(r.amount)}
                    {r.amount_kind === "estimate" ? " (estimate)" : r.amount_kind ? ` (${usageLabel(r.amount_kind)})` : ""}
                  </p>
                ) : (
                  <Figure r={r} />
                )}
                {r.status && <p className="mt-1 break-words">Status: {r.status}</p>}
                {r.next_action && <p className="mt-1 break-words">Next: {r.next_action}</p>}
                <Provenance r={r} />
              </Item>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Home efficiency">
        {data.efficiency.length === 0 ? (
          <None>No efficiency items recorded.</None>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.efficiency.map((r) => (
              <Item key={r.id}>
                <p className="break-words">{r.title}</p>
                <Figure r={r} />
                {r.status && <p className="mt-1 break-words">Status: {r.status}</p>}
                {r.next_action && <p className="mt-1 break-words">Next: {r.next_action}</p>}
                <Provenance r={r} />
              </Item>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
