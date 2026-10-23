import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { formatDate } from "@/components/dates";
import { disconnectGoogle } from "./actions";
import { GoogleStatus, noticeFor, type GoogleConnection } from "./GoogleStatus";

export const dynamic = "force-dynamic";

export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const db = await createUserClient();
  let connection: GoogleConnection = { connected: false, scopes: "", updatedAt: null };
  if (db) {
    const { data } = await db.rpc("google_connection_status");
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.connected) {
      connection = { connected: true, scopes: String(row.scopes ?? ""), updatedAt: row.updated_at ? formatDate(String(row.updated_at), session.datePrefs, true) : null };
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Google connection</h1>
      <GoogleStatus connection={connection} notice={noticeFor(params)} disconnect={disconnectGoogle} />
    </div>
  );
}
