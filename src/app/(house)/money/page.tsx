import Link from "next/link";
import { requireSession } from "@/server/auth/session";
import { listRecords } from "@/server/data/records";
import { todayInLondon } from "@/server/data/dashboard";
import { RenewalList } from "@/components/money/RenewalList";
import { ExpenseList } from "@/components/money/ExpenseList";
import { markVerifiedAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const session = await requireSession();
  const res = await listRecords();
  const records = res.ok ? res.data : null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Money</h1>
      <p className="text-sm text-muted">Figures are as recorded and unverified until marked. No totals are shown.</p>
      <Link
        href="/money/check"
        className="inline-flex min-h-11 items-center self-start rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Check figures
      </Link>
      <RenewalList records={records} today={todayInLondon()} datePrefs={session.datePrefs} verifyAction={markVerifiedAction} />
      <ExpenseList records={records} verifyAction={markVerifiedAction} />
    </div>
  );
}
