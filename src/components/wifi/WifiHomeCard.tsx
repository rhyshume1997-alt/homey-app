"use client";

import Link from "next/link";
import { CardTitle } from "@/components/home/CardTitle";
import { BTN_SECONDARY } from "@/components/tasks/styles";
import type { RevealResult, WifiNetworkView } from "@/contracts/wifi";
import { useWifiShare } from "./useWifiShare";

type Reveal = (id: string) => Promise<RevealResult>;

const LINK = "inline-flex min-h-11 items-center text-sm font-medium underline";

function NetworkRow({ network, reveal }: { network: WifiNetworkView; reveal: Reveal }) {
  const { error, notice, busy, open, share, copyPassword } = useWifiShare(network, reveal);
  return (
    <li className="rounded-md bg-surface-muted px-3 py-2" data-testid="wifi-home-network">
      <p className="text-sm">
        <strong>{network.ssid}</strong>
        <span className="text-muted">{network.is_guest ? " · guest" : ""}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={share} disabled={busy} className={BTN_SECONDARY}>Share</button>
        {!open && <button type="button" onClick={copyPassword} disabled={busy} className={BTN_SECONDARY}>Copy password</button>}
        <Link href={`/wifi#wifi-${network.id}`} className={`${BTN_SECONDARY} inline-flex items-center`}>QR code</Link>
      </div>
      {notice && <p role="status" className="mt-1 text-sm text-muted">{notice}</p>}
      {error && <p role="alert" className="mt-1 text-sm font-medium text-warning-fg">{error}</p>}
    </li>
  );
}

/** Home card: share the household wifi in one tap. Names only come with the page; the password is fetched on tap. */
export function WifiHomeCard({ networks, reveal }: { networks: WifiNetworkView[]; reveal: Reveal }) {
  return (
    <section aria-label="Wifi" data-testid="dashboard-card" className="rounded-lg border border-border bg-surface p-4">
      <CardTitle icon="wifi" tint="teal">Wifi</CardTitle>
      <div className="mt-3">
        {networks.length === 0 ? (
          <>
            <p className="text-sm text-muted">
              Phones don&apos;t let apps see which wifi you&apos;re on, so save it here once. Then you can share it in one tap.
            </p>
            <Link href="/wifi" className={LINK}>Add your wifi</Link>
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {networks.slice(0, 3).map((n) => (
                <NetworkRow key={n.id} network={n} reveal={reveal} />
              ))}
            </ul>
            <Link href="/wifi" className={LINK}>All wifi</Link>
          </>
        )}
      </div>
    </section>
  );
}
