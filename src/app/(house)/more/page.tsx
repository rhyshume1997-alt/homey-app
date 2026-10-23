import Link from "next/link";
import { MembersList, ROLE_LABELS } from "@/components/more/MembersList";
import { MoreHub } from "@/components/more/MoreHub";
import { PushSettings } from "@/components/push/PushSettings";
import { getAuthUser, requireSession } from "@/server/auth/session";
import { loadMembers } from "@/server/data/members";
import { todayInLondon } from "@/server/data/dashboard";
import { DateFormatSettings } from "@/components/settings/DateFormatSettings";
import { saveDateFormatAction } from "../settings-actions";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { saveAppearanceAction } from "../appearance-actions";
import { getAppearance } from "@/server/auth/appearance";
import { HomeySettings } from "@/components/homey/HomeySettings";
import { parseHomeyPrefs } from "@/components/homey/prefs";

export const dynamic = "force-dynamic";

const linkCls =
  "inline-flex min-h-11 w-full items-center rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";


// Placeholders until the real components are wired in.

export default async function MorePage() {
  const session = await requireSession();
  const members = await loadMembers(session.householdId);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">More</h1>

      <section aria-labelledby="account-heading" className="flex flex-col gap-2">
        <h2 id="account-heading" className="text-lg font-semibold">
          Account
        </h2>
        <p className="text-sm">
          Signed in as <strong>{session.displayName}</strong> ({ROLE_LABELS[session.role].toLowerCase()})
        </p>
      </section>

      <MoreHub />

      <div role="group" aria-labelledby="settings-heading" className="flex flex-col gap-3">
        <h2 id="settings-heading" className="text-lg font-semibold">
          Settings
        </h2>
        <Link href="/settings/google" className={linkCls}>
          Google connection
        </Link>
        <DateFormatSettings prefs={session.datePrefs} example={todayInLondon()} action={saveDateFormatAction} />
        <section aria-labelledby="push-heading" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 id="push-heading" className="text-base font-semibold">
            Notifications on this device
          </h3>
          <div className="flex flex-col gap-2 [&_button]:min-h-11 [&_button]:min-w-11">
            <PushSettings />
          </div>
        </section>
      </div>

      {/* Slot: real Appearance component is dropped in here by the orchestrator. */}
      <section aria-labelledby="appearance-heading" data-slot="appearance" className="flex flex-col gap-2">
        <h2 id="appearance-heading" className="text-lg font-semibold">
          Appearance
        </h2>
        <AppearanceSettings current={await getAppearance()} action={saveAppearanceAction} />
      </section>

      {/* Slot: real Homey settings component is dropped in here by the orchestrator. */}
      <section aria-labelledby="homey-heading" data-slot="homey" className="flex flex-col gap-2">
        <h2 id="homey-heading" className="text-lg font-semibold">
          Homey
        </h2>
        <HomeySettings prefs={parseHomeyPrefs((await getAuthUser())?.user.user_metadata)} storageScope={session.userId} />
      </section>

      <section aria-labelledby="household-heading" className="flex flex-col gap-2">
        <h2 id="household-heading" className="text-lg font-semibold">
          Members
        </h2>
        <MembersList members={members ?? []} error={members === null} />
      </section>

      <nav aria-label="Activity" className="flex flex-col gap-2">
        <Link href="/activity" className={linkCls}>
          Activity
        </Link>
      </nav>

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
