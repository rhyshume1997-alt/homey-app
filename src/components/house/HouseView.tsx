import Link from "next/link";
import type { DatePrefs } from "@/components/dates";
import type { HouseholdRecord } from "@/contracts/records";
import type { FormAction } from "@/components/tasks/types";
import { Empty, RecordCard, Section } from "./RecordCard";

export function HouseView({
  records,
  datePrefs,
  verifyAction,
}: {
  records: readonly HouseholdRecord[] | null;
  datePrefs?: DatePrefs;
  verifyAction: FormAction;
}) {
  const rows = [...(records ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const epc = rows.filter((r) => /\bepc\b|energy performance/i.test(r.title));
  const rest = rows.filter((r) => !epc.includes(r));
  const card = (r: HouseholdRecord) => <RecordCard key={r.id} r={r} datePrefs={datePrefs} verifyAction={verifyAction} />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">House</h1>
      <p className="text-sm text-muted">Facts as recorded. Amounts are unverified until marked.</p>
      <Section title="Property">
        {records === null ? <Empty failed /> : rest.length === 0 ? <Empty /> : <ul className="mt-3 flex flex-col gap-2">{rest.map(card)}</ul>}
      </Section>
      {epc.length > 0 && (
        <Section title="Energy performance (EPC)" note="Shown as recorded, with its status.">
          <ul className="mt-3 flex flex-col gap-2">{epc.map(card)}</ul>
        </Section>
      )}
      <Section title="Documents">
        <Link
          href="/documents"
          className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Open documents
        </Link>
      </Section>
    </div>
  );
}
