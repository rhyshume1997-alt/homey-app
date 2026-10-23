import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { sanitizeNext } from "@/server/auth/next-param";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  denied: "That Google account isn't on the allowlist",
  unavailable: "Sign-in isn't available right now",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (await getSession()) redirect("/");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const errorCode = one(sp.error);
  const message = errorCode && Object.hasOwn(MESSAGES, errorCode) ? MESSAGES[errorCode] : null;
  const next = sanitizeNext(one(sp.next));
  const href = next && next !== "/" ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">Our Home</h1>
      {message ? (
        <p role="alert" className="text-muted">
          {message}
        </p>
      ) : null}
      <a href={href} className="inline-flex min-h-12 items-center justify-center rounded border px-4 py-2 text-center font-medium">
        Sign in with Google
      </a>
      <p className="flex gap-4 text-sm text-muted">
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">Privacy policy</Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-2">Terms of use</Link>
      </p>
    </main>
  );
}
