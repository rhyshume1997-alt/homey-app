import { requireSession } from "@/server/auth/session";
import { getServerEnv, isPrimaryHousehold } from "@/server/env";
import { getMonthSpendPence } from "@/server/ai/usage";
import { listPendingProposals } from "@/server/ai/proposals";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { ProposalList } from "@/components/assistant/ProposalList";
import { AssistantOff, SpendMeter } from "@/components/assistant/SpendMeter";
import { confirmProposalAction, rejectProposalAction, sendMessageAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const s = await requireSession();
  const env = getServerEnv();
  const [spent, proposals] = await Promise.all([getMonthSpendPence(s), listPendingProposals(s)]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Homey chat</h1>
      <p className="text-sm text-muted">Proposals need your confirmation</p>
      <SpendMeter spentPence={spent} capGbp={env.AI_MONTHLY_CAP_GBP} />
      {env.ANTHROPIC_API_KEY && isPrimaryHousehold(s.householdId) ? <AssistantChat send={sendMessageAction} /> : <AssistantOff />}
      <ProposalList proposals={proposals} confirm={confirmProposalAction} reject={rejectProposalAction} />
    </div>
  );
}
