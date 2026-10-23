"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { markAllRead, markRead } from "@/server/data/notifications";

export async function markReadAction(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id === "string") await markRead(id);
  revalidatePath("/notifications");
}

export async function markAllReadAction(): Promise<void> {
  const s = await requireSession();
  await markAllRead(s.userId);
  revalidatePath("/notifications");
}
