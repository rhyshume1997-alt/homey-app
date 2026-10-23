import Link from "next/link";
import { requireSession } from "@/server/auth/session";
import { listRecords } from "@/server/data/records";
import { FigureCheckList } from "@/components/money/FigureCheckList";
import { confirmFigureAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CheckFiguresPage() {
  const session = await requireSession();
  const res = await listRecords();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Check figures</h1>
      <p className="text-sm text-muted">
        These amounts came from the master record and nobody has checked them yet. Compare each one with the latest bill or
        statement, correct it if needed, then mark it checked.
      </p>
      <FigureCheckList records={res.ok ? res.data : null} action={confirmFigureAction} datePrefs={session.datePrefs} />
      <Link href="/money" className="inline-flex min-h-11 items-center text-sm font-medium underline">
        Back to Money
      </Link>
    </div>
  );
}
