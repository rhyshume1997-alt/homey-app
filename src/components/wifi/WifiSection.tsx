"use client";

import { useActionState } from "react";
import { useWifiShare } from "./useWifiShare";
import type { FormAction } from "@/components/tasks/types";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from "@/components/tasks/styles";
import { WIFI_LIMITS, WIFI_SECURITIES, WIFI_SECURITY_LABEL, type RevealResult, type WifiNetworkView } from "@/contracts/wifi";

export type WifiNetwork = WifiNetworkView & { hasPassword: boolean; qrSvg: string | null };
export type WifiActions = {
  reveal: (id: string) => Promise<RevealResult>;
  save: FormAction;
  remove: FormAction;
};

// 44px tap area; the visible box is the 24px content area (filled when ticked).
const CHECK = "size-11 shrink-0 cursor-pointer appearance-none rounded-xl bg-border bg-clip-content p-2.5 checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2";

const NOTE = "A web app can't detect when someone joins your wifi. Show this QR to guests.";

function NetworkForm({ network, action, submitLabel }: { network?: WifiNetwork; action: FormAction; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {network && <input type="hidden" name="id" value={network.id} />}
      <label className={LABEL}>
        Network name
        <input name="ssid" required maxLength={WIFI_LIMITS.ssid} defaultValue={network?.ssid} className={FIELD} />
      </label>
      <label className={LABEL}>
        Security
        <select name="security" defaultValue={network?.security ?? "WPA"} className={FIELD}>
          {WIFI_SECURITIES.map((s) => (
            <option key={s} value={s}>{WIFI_SECURITY_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Password
        <input
          name="password"
          type="password"
          autoComplete="off"
          maxLength={WIFI_LIMITS.password}
          placeholder={network?.hasPassword ? "Leave blank to keep the current password" : ""}
          className={FIELD}
        />
      </label>
      <label className="flex items-center gap-1 text-sm font-medium">
        <input type="checkbox" className={CHECK} name="hidden" defaultChecked={network?.hidden} /> Hidden network
      </label>
      <label className="flex items-center gap-1 text-sm font-medium">
        <input type="checkbox" className={CHECK} name="is_guest" defaultChecked={network ? network.is_guest : true} /> Guest network
      </label>
      {state?.error && <p role="alert" className="text-sm font-medium text-warning-fg">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>{submitLabel}</button>
    </form>
  );
}

function RemoveForm({ id, action }: { id: string; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={BTN_DANGER}>Confirm remove</button>
      {state?.error && <p role="alert" className="text-sm text-warning-fg">{state.error}</p>}
    </form>
  );
}

function NetworkCard({ network, actions }: { network: WifiNetwork; actions: WifiActions }) {
  const { password, error, notice, busy, open, fetchPassword, share, copyPassword, hide } = useWifiShare(network, actions.reveal);

  return (
    <section id={`wifi-${network.id}`} aria-label={network.ssid} data-testid="wifi-network" className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">{network.ssid}</h2>
        <p className="text-sm text-muted">
          {WIFI_SECURITY_LABEL[network.security]}
          {network.is_guest ? " · guest network" : ""}
          {network.hidden ? " · hidden" : ""}
        </p>
        {!open && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm text-muted">Password</span>
            {password === null ? (
              <>
                <span aria-hidden="true" className="tracking-widest">••••••••••</span>
                <button type="button" onClick={fetchPassword} disabled={busy} className={BTN_SECONDARY}>Tap to reveal</button>
              </>
            ) : (
              <>
                <span data-testid="wifi-password" className="break-all font-mono text-base">{password}</span>
                <button type="button" onClick={hide} className={BTN_SECONDARY}>Hide</button>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm font-medium text-warning-fg">{error}</p>}
      </div>

      {network.qrSvg && (
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <div
            role="img"
            aria-label={`QR code to join ${network.ssid}`}
            className="mx-auto w-full max-w-72 rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: network.qrSvg }}
          />
          <p className="mt-2 text-sm text-muted">Guest scans with their camera to join</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={share} disabled={busy} className={BTN_SECONDARY}>Share</button>
        {!open && <button type="button" onClick={copyPassword} disabled={busy} className={BTN_SECONDARY}>Copy password</button>}
      </div>
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
      <p className="text-center text-sm text-muted">{NOTE}</p>

      <details className="rounded-md bg-surface-muted px-3">
        <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Edit {network.ssid}</summary>
        <div className="pb-3">
          <NetworkForm network={network} action={actions.save} submitLabel="Save changes" />
        </div>
      </details>
      <details className="rounded-md bg-surface-muted px-3">
        <summary className="min-h-[var(--touch-target)] cursor-pointer py-2 text-sm font-medium">Remove {network.ssid}</summary>
        <div className="pb-3"><RemoveForm id={network.id} action={actions.remove} /></div>
      </details>
    </section>
  );
}

export function WifiSection({ networks, actions }: { networks: WifiNetwork[]; actions: WifiActions }) {
  return (
    <div className="flex flex-col gap-6">
      {networks.length === 0 && <p className="text-muted">No wifi network saved yet.</p>}
      {networks.map((n) => (
        <NetworkCard key={n.id} network={n} actions={actions} />
      ))}
      <section aria-label="Add a network" className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-lg font-semibold">{networks.length === 0 ? "Add your wifi" : "Add another network"}</h2>
        {networks.length === 0 && (
          <p className="mb-3 text-sm text-muted">
            Phones don&apos;t let apps see which wifi you&apos;re on, so add it once here. To copy the password of the
            network you&apos;re on: iPhone, Settings › Wi-Fi › ⓘ next to the network › Password. Android, Settings ›
            Wi-Fi › the network › Share.
          </p>
        )}
        <NetworkForm action={actions.save} submitLabel="Add network" />
        <p className="mt-3 text-sm text-muted">The password is stored encrypted and is only shown to household members. Never shared as a public link.</p>
      </section>
    </div>
  );
}
