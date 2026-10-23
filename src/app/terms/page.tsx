import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, PublicPage } from "@/components/public/PublicPage";

export const metadata: Metadata = { title: "Terms of use: Our Home" };

export default function TermsPage() {
  return (
    <PublicPage>
      <h1 className="text-3xl font-semibold">Terms of use</h1>
      <p className="text-muted">Last updated 22 October 2026.</p>
      <p>
        Our Home (house.rdhcoaching.com) is a private household app run by Rhys Hume for his own household. These
        terms apply to anyone who uses it.
      </p>
      <h2 className="text-xl font-semibold">Who can use it</h2>
      <p>
        Only people invited by the owner can sign in, using an allowed Google account. There is no public sign-up.
        You must not try to access the app or its data without an invitation.
      </p>
      <h2 className="text-xl font-semibold">What it does and does not do</h2>
      <p>
        The app records and displays household information and reads selected Google data with your permission. It
        does not move money, make purchases, send email or contact companies on your behalf. Suggestions from the
        built-in assistant are only applied after you confirm them. Figures shown in the app may be unverified and are
        not financial advice.
      </p>
      <h2 className="text-xl font-semibold">Availability</h2>
      <p>
        The app is provided as is, free of charge, without any guarantee that it will be available or error free.
        Access can be removed at any time.
      </p>
      <h2 className="text-xl font-semibold">Your data</h2>
      <p>
        How data is handled is described in the <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>.
      </p>
      <h2 className="text-xl font-semibold">Contact</h2>
      <p>
        Questions: <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">{CONTACT_EMAIL}</a>.
      </p>
    </PublicPage>
  );
}
