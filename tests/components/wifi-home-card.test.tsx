// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WifiHomeCard } from "@/components/wifi/WifiHomeCard";
import type { WifiNetworkView } from "@/contracts/wifi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = "00000000-0000-4000-8000-000000000001";
const net = (o: Partial<WifiNetworkView> = {}): WifiNetworkView => ({ id: ID, ssid: "Example-Home", security: "WPA", hidden: false, is_guest: false, ...o });

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText }, share: undefined });
  return writeText;
}

describe("WifiHomeCard", () => {
  it("explains there is no auto-detect and links to add the wifi when none is saved", () => {
    render(<WifiHomeCard networks={[]} reveal={vi.fn()} />);
    expect(screen.getByText(/Phones don.t let apps see which wifi/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add your wifi" }).getAttribute("href")).toBe("/wifi");
  });

  it("shows names only and never fetches the password until a tap", () => {
    const reveal = vi.fn();
    const { container } = render(<WifiHomeCard networks={[net()]} reveal={reveal} />);
    expect(screen.getByText("Example-Home")).toBeTruthy();
    expect(reveal).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toMatch(/WIFI:|P:/);
  });

  it("Copy password fetches it on tap and copies only the password", async () => {
    const writeText = stubClipboard();
    const reveal = vi.fn(async () => ({ ok: true as const, password: "s3cret-pass" }));
    render(<WifiHomeCard networks={[net()]} reveal={reveal} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("s3cret-pass"));
    expect(reveal).toHaveBeenCalledWith(ID);
    expect(screen.getByRole("status").textContent).toBe("Password copied.");
    expect(screen.queryByText("s3cret-pass")).toBeNull();
  });

  it("Share falls back to copying name and password when there is no share sheet", async () => {
    const writeText = stubClipboard();
    render(<WifiHomeCard networks={[net()]} reveal={async () => ({ ok: true as const, password: "pw" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Wifi: Example-Home / pw"));
  });

  it("shows the server's refusal (for example the reveal rate limit) and copies nothing", async () => {
    const writeText = stubClipboard();
    render(<WifiHomeCard networks={[net()]} reveal={async () => ({ ok: false as const, error: "Too many reveals. Please wait a minute." })} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many reveals"));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("open networks have no Copy password; QR links to that network on the wifi page; at most 3 rows", () => {
    const nets = [net({ security: "nopass" }), ...[2, 3, 4].map((i) => net({ id: `00000000-0000-4000-8000-00000000000${i}`, ssid: `N${i}` }))];
    render(<WifiHomeCard networks={nets} reveal={vi.fn()} />);
    expect(screen.getAllByTestId("wifi-home-network")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Copy password" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "QR code" })[0].getAttribute("href")).toBe(`/wifi#wifi-${ID}`);
  });
});
