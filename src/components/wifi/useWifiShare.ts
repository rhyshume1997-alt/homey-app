"use client";

import { useState } from "react";
import type { RevealResult, WifiNetworkView } from "@/contracts/wifi";

type Reveal = (id: string) => Promise<RevealResult>;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reveal, share and copy for one network. The password is fetched from the server only when
 * someone taps, kept in memory for this component, and never put in a URL or logged.
 */
export function useWifiShare(network: Pick<WifiNetworkView, "id" | "ssid" | "security">, reveal: Reveal) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = network.security === "nopass";

  async function fetchPassword(): Promise<string | null> {
    if (password !== null) return password;
    setBusy(true);
    setError(null);
    try {
      const r = await reveal(network.id);
      if (!r.ok) {
        setError(r.error);
        return null;
      }
      setPassword(r.password);
      return r.password;
    } catch {
      setError("Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setNotice(null);
    const pw = open ? "" : await fetchPassword();
    if (pw === null) return;
    const text = open ? `Wifi: ${network.ssid}` : `Wifi: ${network.ssid} / ${pw}`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: network.ssid, text });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    if (await copy(text)) setNotice("Copied to the clipboard.");
    else setError("Could not share or copy. Reveal the password and share it by hand.");
  }

  async function copyPassword() {
    setNotice(null);
    const pw = await fetchPassword();
    if (pw === null) return;
    if (await copy(pw)) setNotice("Password copied.");
    else setError("Could not copy. Reveal the password and copy it by hand.");
  }

  return { password, error, notice, busy, open, fetchPassword, share, copyPassword, hide: () => setPassword(null) };
}
