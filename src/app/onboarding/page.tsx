import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreateHouseholdForm, JoinHouseholdForm } from "@/components/household/OnboardingForms";
import { getAuthOnly, getSession } from "@/server/auth/session";
import { INVITE_COOKIE, isInviteToken } from "@/server/auth/household-cookie";
import { acceptInviteAction, createHouseholdAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** Signed in, membership not required. Invite first; otherwise anyone signed in can create their own household. */
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await getAuthOnly())) redirect("/login");
  const sp = await searchParams;
  const hasInvite = isInviteToken((await cookies()).get(INVITE_COOKIE)?.value);
  const badLink = sp.invite === "invalid";
  // Already in a household and nothing to accept: nothing to do here.
  if (!hasInvite && !badLink && (await getSession())) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Our Home</h1>
      {badLink ? (
        <p role="alert" className="text-sm">
          That invite link isn&apos;t valid. Ask the household owner for a new one.
        </p>
      ) : null}
      {hasInvite ? (
        <section aria-labelledby="join-heading" className="flex flex-col gap-3">
          <h2 id="join-heading" className="text-lg font-semibold">
            Join the household
          </h2>
          <p className="text-sm text-muted">
            You were invited. Choose the name the household will see, then join. The invite only works for the email you signed in with.
          </p>
          <JoinHouseholdForm action={acceptInviteAction} />
        </section>
      ) : (
        <section aria-labelledby="create-heading" className="flex flex-col gap-3">
          <h2 id="create-heading" className="text-lg font-semibold">
            Create your household
          </h2>
          <CreateHouseholdForm action={createHouseholdAction} />
          <p className="text-sm text-muted">Joining someone else&apos;s household? Open the invite link they sent you.</p>
        </section>
      )}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
