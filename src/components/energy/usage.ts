import type { MeterFuel, MeterReading } from "@/contracts/meter-readings";

/** Usage between two consecutive confirmed readings of the same fuel and unit. */
export type UsagePeriod = {
  fuel: MeterFuel;
  unit: MeterReading["unit"];
  from: string;
  to: string;
  days: number;
  used: number;
  perDay: number;
};

const DAY = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Differences between consecutive readings only. Readings are never estimated or interpolated:
 * a pair with a lower later value (meter swap or typo), a different unit or the same day yields
 * no period, and a gap is shown as the span between the two real readings, never filled.
 */
export function computeUsage(
  readings: MeterReading[],
  fuel: MeterFuel,
): { periods: UsagePeriod[]; skipped: number; count: number } {
  const rs = readings.filter((r) => r.fuel === fuel).sort((a, b) => a.read_on.localeCompare(b.read_on));
  const periods: UsagePeriod[] = [];
  let skipped = 0;
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1];
    const b = rs[i];
    const days = dayDiff(a.read_on, b.read_on);
    const used = Math.round((b.value - a.value) * 1000) / 1000;
    if (a.unit !== b.unit || days <= 0 || used < 0) {
      skipped++;
      continue;
    }
    periods.push({ fuel, unit: b.unit, from: a.read_on, to: b.read_on, days, used, perDay: used / days });
  }
  return { periods, skipped, count: rs.length };
}
