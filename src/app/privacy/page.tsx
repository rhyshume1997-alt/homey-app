import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, PublicPage } from "@/components/public/PublicPage";
import { GMAIL_SCOPE, SHEETS_SCOPE } from "@/server/integrations/google/scopes";

export const metadata: Metadata = { title: "Privacy policy: Our Home" };

const h2 = "text-xl font-semibold mt-2";
const a = "underline underline-offset-2 break-words";
const POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

export default function PrivacyPage() {
  return (
    <PublicPage>
      <h1 className="text-3xl font-semibold">Privacy policy</h1>
      <p className="text-muted">Last updated 22 October 2026.</p>
      <p>
        Our Home (house.rdhcoaching.com) is a private household management app used only by Rhys Hume and Rachel King
        for their own home. It is run by Rhys Hume, who is responsible for the data it holds. Contact:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className={a}>{CONTACT_EMAIL}</a>.
      </p>

      <h2 className={h2}>Who can use the app</h2>
      <p>
        There is no public sign-up. Only Google accounts on a private allowlist can sign in. Every page and every piece
        of data is protected by sign-in, and each household can only see its own data.
      </p>

      <h2 className={h2}>Google data we access and why</h2>
      <p>We only request the Google permissions below, and only for the purposes listed.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>Sign in with Google</strong> (<code>openid</code>, <code>email</code>, <code>profile</code>): your
          name and email address, used to sign you in and check that your account is on the allowlist.
        </li>
        <li>
          <strong>Google Sheets, read-only</strong> (<code className="break-all">{SHEETS_SCOPE}</code>): reads the
          household costs spreadsheet you choose, so the app can show household bills and contributions. The app never
          edits your spreadsheets.
        </li>
        <li>
          <strong>Gmail, read-only</strong> (<code className="break-all">{GMAIL_SCOPE}</code>): reads message details
          (sender domain, subject and dates) to show household emails that are waiting for a reply, and reads the
          content of emails from specific household senders you approve (for example an appliance maker or an energy
          supplier) to draft records such as warranty dates or meter readings. Drafts are shown to you and are only
          saved when you confirm them. The app never sends, deletes or changes email.
        </li>
      </ul>
      <p>
        These Sheets and Gmail permissions are optional and asked for separately, only when you choose &quot;Connect
        Google&quot; in the app. You can untick them on Google&apos;s consent screen.
      </p>

      <h2 className={h2}>How Google data is stored</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          The Google refresh token that lets the app read your Sheets and Gmail is encrypted with AES-256-GCM before it
          is stored, using a key held only on the server. Only your own signed-in session can use it.
        </li>
        <li>
          From Gmail we store only what is needed: a hashed thread identifier, the subject, the sender&apos;s domain
          and dates. Email bodies are not stored. Fields you confirm from an email (such as a warranty end date) are
          saved as household records.
        </li>
        <li>
          From Sheets we store a snapshot of the costs figures so the other household member can see the last view.
        </li>
        <li>
          Data is held in a private database (Supabase, EU region, Ireland) and the app is hosted on Vercel. All
          traffic is encrypted in transit.
        </li>
      </ul>

      <h2 className={h2}>Sharing</h2>
      <p>
        We do not sell, rent or share Google user data or any other personal data. It is not used for advertising and
        is not used to train AI models. Google user data is not sent to the AI assistant&apos;s provider. The built-in
        assistant (Anthropic&apos;s Claude) only receives short household task and bill titles, dates and first names,
        without amounts, email content or documents. Data is only shared with the service providers needed to run the
        app (Supabase for storage, Vercel for hosting) or if required by law.
      </p>

      <h2 className={h2}>Limited Use</h2>
      <p>
        Our Home&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a href={POLICY_URL} className={a}>Google API Services User Data Policy</a>, including the Limited Use
        requirements.
      </p>

      <h2 className={h2}>Retention, deletion and revoking access</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Household data is kept for as long as the household uses the app. Ask us and we will delete your data within
          30 days.
        </li>
        <li>
          You can disconnect Google at any time in the app (More, then Google). This deletes the stored token and
          revokes it at Google straight away.
        </li>
        <li>
          You can also remove the app&apos;s access from your Google Account at{" "}
          <a href="https://myaccount.google.com/permissions" className={a}>myaccount.google.com/permissions</a>.
        </li>
      </ul>

      <h2 className={h2}>Your rights</h2>
      <p>
        You can ask for a copy of your data, ask for it to be corrected or deleted, or object to how it is used, by
        emailing <a href={`mailto:${CONTACT_EMAIL}`} className={a}>{CONTACT_EMAIL}</a>. If you are in the UK you can
        also complain to the Information Commissioner&apos;s Office (ico.org.uk).
      </p>

      <h2 className={h2}>Changes</h2>
      <p>
        If this policy changes, the date at the top is updated. See also the{" "}
        <Link href="/terms" className={a}>terms of use</Link>.
      </p>
    </PublicPage>
  );
}
