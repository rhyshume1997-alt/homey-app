import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { SUPPLY_STATUS_LABEL, sortSupplies, type SupplyStatus } from "@/components/shopping/types";

export interface SuppliesCardData {
  /** Supplies a person marked low or out. */
  lowSupplies: { id: string; name: string; status: SupplyStatus }[];
  totalSupplies: number;
  openShoppingCount: number;
}

/** Null data means it could not be loaded. Shows only levels a person entered. */
export function SuppliesCard({ data }: { data: SuppliesCardData | null }) {
  const low = data ? sortSupplies(data.lowSupplies.filter((s) => s.status !== "ok")) : [];
  return (
    <section aria-label="Supplies" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="cart" tint="teal">Supplies</CardTitle>
      <div className="mt-3">
        {data === null ? (
          <p className="text-sm text-muted">Could not load this right now.</p>
        ) : (
          <>
            {low.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {low.map((s) => (
                  <li key={s.id} className="rounded-md bg-surface-muted px-3 py-2">
                    <strong>{s.name}</strong>
                    <span className="text-muted"> {SUPPLY_STATUS_LABEL[s.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{data.totalSupplies > 0 ? "Nothing running low" : "No supplies tracked yet"}</p>
            )}
            <p className="mt-2 text-sm"><strong>{data.openShoppingCount}</strong> open on the shopping list</p>
          </>
        )}
      </div>
      <Link
        href="/shopping"
        className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Shopping and supplies
      </Link>
    </section>
  );
}
