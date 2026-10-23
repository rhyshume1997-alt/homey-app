"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { createUserClient } from "@/server/db/supabase";
import { getServerEnv } from "@/server/env";
import { decryptToken } from "@/server/integrations/google/crypto";
import { clearAccessTokenCache, currentUserStore, revokeToken } from "@/server/integrations/google/token";

/** Revokes the token at Google (best effort), then always deletes the stored copy. */
export async function disconnectGoogle(): Promise<void> {
  const s = await requireSession();
  const store = await currentUserStore();
  const key = getServerEnv().GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (store && store.userId === s.userId) {
    try {
      const row = await store.get();
      if (row && key) await revokeToken(decryptToken(row.ciphertext, key, s.userId));
    } catch {
      // best effort: still delete below
    }
    const db = await createUserClient();
    if (db) await db.rpc("delete_my_google_token");
  }
  clearAccessTokenCache(s.userId);
  revalidatePath("/settings/google");
  revalidatePath("/budget");
  revalidatePath("/replies");
  redirect("/settings/google?disconnected=1");
}
