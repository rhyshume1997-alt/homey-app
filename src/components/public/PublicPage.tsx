import Link from "next/link";

export const CONTACT_EMAIL = "rhyshume1997@gmail.com";

const link = "underline underline-offset-2 inline-flex min-h-11 items-center";

/** Frame for the public pages (landing, privacy, terms): no session, no household data. */
export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="text-xl font-semibold">
          Our Home
        </Link>
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4">
        {children}
      </main>
      <footer className="mt-10 flex flex-wrap gap-x-6 border-t border-border pt-4 text-sm text-muted">
        <Link href="/" className={link}>Home</Link>
        <Link href="/privacy" className={link}>Privacy policy</Link>
        <Link href="/terms" className={link}>Terms of use</Link>
        <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>
      </footer>
    </div>
  );
}
