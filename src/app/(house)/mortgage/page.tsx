import { requireSession } from "@/server/auth/session";
import { getMortgageRecords } from "@/server/data/house";
import { todayInLondon } from "@/server/data/dashboard";
import { MortgageView } from "@/components/house/MortgageView";
import { markVerifiedAction } from "../money/actions";

export const dynamic = "force-dynamic";

export default async function MortgagePage() {
  const session = await requireSession();
  const records = await getMortgageRecords();
  return <MortgageView records={records} today={todayInLondon()} datePrefs={session.datePrefs} verifyAction={markVerifiedAction} />;
}
