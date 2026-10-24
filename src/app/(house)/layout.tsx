import { AppShell } from "@/components/AppShell";
import { requireSession } from "@/server/auth/session";

export default async function HouseLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <AppShell showSnags={session.showSnags}>
      <form action="/auth/signout" method="post" className="flex justify-end p-2">
        <button type="submit" className="inline-flex min-h-11 min-w-11 items-center px-3 text-sm underline">
          Sign out
        </button>
      </form>
      {children}
    </AppShell>
  );
}
