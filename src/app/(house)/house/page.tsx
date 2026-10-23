import { requireSession } from "@/server/auth/session";
import { getPropertyRecords } from "@/server/data/house";
import { HouseView } from "@/components/house/HouseView";
import { markVerifiedAction } from "../money/actions";

export const dynamic = "force-dynamic";

export default async function HousePage() {
  const session = await requireSession();
  const records = await getPropertyRecords();
  return <HouseView records={records} datePrefs={session.datePrefs} verifyAction={markVerifiedAction} />;
}
