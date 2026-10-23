import { requireSession } from "@/server/auth/session";
import { householdSecretsConfigured, listWifiForPage } from "@/server/data/wifi";
import { WifiSection } from "@/components/wifi/WifiSection";
import { removeWifiAction, revealWifiPasswordAction, saveWifiAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WifiPage() {
  const s = await requireSession();
  const configured = householdSecretsConfigured();
  const list = configured ? await listWifiForPage(s) : null;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Guest wifi</h1>
        <p className="text-sm text-muted">Members only</p>
      </header>
      {!configured || !list ? (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          Wifi storage isn&apos;t set up
        </p>
      ) : !list.ok ? (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          {list.error}
        </p>
      ) : (
        <WifiSection
          networks={list.data}
          actions={{ reveal: revealWifiPasswordAction, save: saveWifiAction, remove: removeWifiAction }}
        />
      )}
    </div>
  );
}
