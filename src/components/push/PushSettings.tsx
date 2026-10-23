"use client";

import { useEffect, useState, useTransition } from "react";
import { sendTestPushAction, subscribePushAction, unsubscribePushAction } from "@/server/integrations/push/actions";

type Status = "checking" | "unsupported" | "unconfigured" | "off" | "on" | "denied";

function keyToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const LABELS: Record<Status, string> = {
  checking: "Checking this device...",
  unsupported: "This browser cannot receive notifications. On iPhone, add Our Home to the Home Screen first.",
  unconfigured: "Notifications are not set up yet.",
  off: "Notifications are off on this device.",
  on: "Notifications are on for this device.",
  denied: "Notifications are blocked. Allow them in your device settings for Our Home.",
};

const BTN = "rounded-md bg-surface-muted px-3 py-2 text-sm font-medium disabled:opacity-50";

export function PushSettings() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (live) setStatus("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!live) return;
        if (Notification.permission === "denied") setStatus("denied");
        else setStatus(sub ? "on" : "off");
      } catch {
        if (live) setStatus("unsupported");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  function enable() {
    start(async () => {
      setMessage("");
      try {
        const keyRes = await fetch("/api/push/public-key", { cache: "no-store" });
        if (keyRes.status === 404) {
          setStatus("unconfigured");
          return;
        }
        if (!keyRes.ok) throw new Error("key");
        const { publicKey } = (await keyRes.json()) as { publicKey: string };
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setStatus(perm === "denied" ? "denied" : "off");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
        const res = await subscribePushAction({
          endpoint: sub.endpoint,
          p256dh: bufToB64url(sub.getKey("p256dh")),
          auth: bufToB64url(sub.getKey("auth")),
          userAgent: navigator.userAgent.slice(0, 200),
        });
        setMessage(res.message);
        if (res.ok) setStatus("on");
      } catch {
        setMessage("Could not enable notifications. Try again.");
      }
    });
  }

  function disable() {
    start(async () => {
      setMessage("");
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await unsubscribePushAction(sub.endpoint);
          await sub.unsubscribe();
        }
        setStatus("off");
        setMessage("Notifications turned off on this device.");
      } catch {
        setMessage("Could not turn off notifications. Try again.");
      }
    });
  }

  function test() {
    start(async () => {
      const res = await sendTestPushAction();
      setMessage(res.message);
    });
  }

  const cannotEnable = status === "checking" || status === "unsupported" || status === "unconfigured" || status === "denied";

  return (
    <section aria-labelledby="push-heading" className="flex flex-col gap-3">
      <h2 id="push-heading" className="text-base font-semibold">
        Notifications
      </h2>
      <p className="text-sm text-muted">
        On iPhone, notifications only work after you add Our Home to your Home Screen (Share, then Add to Home Screen)
        and open it from there. This needs iOS 16.4 or later.
      </p>
      <p className="text-sm" role="status">
        {LABELS[status]}
      </p>
      <div className="flex flex-wrap gap-2">
        {status === "on" ? (
          <button type="button" onClick={disable} disabled={pending} className={BTN}>
            Turn off on this device
          </button>
        ) : (
          <button type="button" onClick={enable} disabled={pending || cannotEnable} className={BTN}>
            Enable notifications
          </button>
        )}
        <button type="button" onClick={test} disabled={pending || status !== "on"} className={BTN}>
          Send test notification to me
        </button>
      </div>
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
