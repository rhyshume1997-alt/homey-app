"use client";

import { useEffect } from "react";

/** Registers the (non-caching) service worker in production builds only. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installability is optional; fail silently.
    });
  }, []);
  return null;
}
