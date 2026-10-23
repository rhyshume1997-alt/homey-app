import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appleWebAppMetadata } from "./pwa";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { getAppearance } from "@/server/auth/appearance";

export const metadata: Metadata = {
  title: "Our Home",
  description: "Private household app",
  robots: { index: false, follow: false, noarchive: true },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: appleWebAppMetadata,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16131d" },
    { media: "(prefers-color-scheme: dark)", color: "#16131d" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) report the iPhone home-indicator space used by the bottom nav.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appearance = await getAppearance();
  return (
    <html lang="en-GB" data-theme={appearance} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
