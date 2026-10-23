import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public/PublicPage";

// Served at "/" to signed-out visitors (the proxy rewrites to this page). Rendered per request
// so no CDN copy of "/" is ever cached.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Our Home: a private household app",
  description: "Our Home is a private household management app for Rhys and Rachel.",
};

const FEATURES = [
  "Tasks and chores, with due dates and repeats",
  "Bills, renewals and household costs, including a read-only view of our own Google Sheets costs sheet",
  "Bin collection days and reminders",
  "A shared household calendar of what is coming up",
  "Snags, maintenance, documents and shopping lists",
];

export default function WelcomePage() {
  return (
    <PublicPage>
      <h1 className="text-3xl font-semibold">A private household app</h1>
      <p>
        Our Home is a private web app that Rhys and Rachel use to run their own home together. It keeps track of
        household tasks, bills, bins, the calendar and the costs spreadsheet in one place.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {FEATURES.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="text-muted">
        It is not a public service: there is no sign-up, and only the two invited Google accounts can sign in. Google
        data is read only with the person&apos;s own permission and never sold or shared. See the{" "}
        <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>.
      </p>
      <Link
        href="/login"
        className="inline-flex min-h-12 items-center justify-center self-start rounded-md bg-accent px-5 font-semibold text-accent-foreground"
      >
        Sign in
      </Link>
    </PublicPage>
  );
}
