import { requireSession } from "@/server/auth/session";
import { getContactsData } from "@/server/data/house";
import { ContactsView } from "@/components/house/ContactsView";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const session = await requireSession();
  const data = await getContactsData();
  return <ContactsView data={data} datePrefs={session.datePrefs} />;
}
