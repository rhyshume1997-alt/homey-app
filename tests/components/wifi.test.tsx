// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WifiSection, type WifiActions, type WifiNetwork } from "@/components/wifi/WifiSection";
import { escapeWifiField, wifiQrPayload } from "@/contracts/wifi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = async () => null;
const net = (o: Partial<WifiNetwork> = {}): WifiNetwork => ({
  id: "00000000-0000-4000-8000-000000000001",
  ssid: "Example-Guest",
  security: "WPA",
  hidden: false,
  is_guest: true,
  hasPassword: true,
  qrSvg: "<svg data-testid='qr'></svg>",
  ...o,
});
const actions = (reveal: WifiActions["reveal"]): WifiActions => ({ reveal, save: noop, remove: noop });

describe("wifi QR payload", () => {
  it("builds the standard format", () => {
    expect(wifiQrPayload({ ssid: "Home", security: "WPA", password: "pass1234", hidden: false })).toBe("WIFI:T:WPA;S:Home;P:pass1234;H:false;;");
    expect(wifiQrPayload({ ssid: "Open", security: "nopass", password: null, hidden: true })).toBe("WIFI:T:nopass;S:Open;H:true;;");
  });
  it("escapes ; , : \\ and \"", () => {
    expect(escapeWifiField('a;b,c:d\\e"f')).toBe('a\\;b\\,c\\:d\\\\e\\"f');
    expect(wifiQrPayload({ ssid: "a;b", security: "WPA", password: 'p:"q', hidden: false })).toBe('WIFI:T:WPA;S:a\\;b;P:p\\:\\"q;H:false;;');
  });
});

describe("WifiSection", () => {
  it("hides the password until revealed and never renders it up front", async () => {
    const reveal = vi.fn(async () => ({ ok: true as const, password: "s3cret-pass" }));
    const { container } = render(<WifiSection networks={[net()]} actions={actions(reveal)} />);
    expect(screen.getByText("Example-Guest")).toBeTruthy();
    expect(container.textContent).not.toContain("s3cret-pass");
    fireEvent.click(screen.getByRole("button", { name: "Tap to reveal" }));
    await waitFor(() => expect(screen.getByTestId("wifi-password").textContent).toBe("s3cret-pass"));
    expect(reveal).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("shows a reveal error such as the rate limit", async () => {
    render(<WifiSection networks={[net()]} actions={actions(async () => ({ ok: false as const, error: "Too many reveals." }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap to reveal" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too many reveals.");
  });

  it("shows the QR, the guest note and an edit form that keeps the old password when blank", () => {
    render(<WifiSection networks={[net()]} actions={actions(async () => ({ ok: true as const, password: "x" }))} />);
    expect(screen.getByRole("img", { name: "QR code to join Example-Guest" })).toBeTruthy();
    expect(screen.getByText("A web app can't detect when someone joins your wifi. Show this QR to guests.")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("Leave blank to keep the current password").length).toBe(1);
  });

  it("shares with navigator.share, name and password", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<WifiSection networks={[net()]} actions={actions(async () => ({ ok: true as const, password: "pw1" }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Example-Guest", text: "Wifi: Example-Guest / pw1" }));
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("falls back to copy when share is unavailable", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<WifiSection networks={[net()]} actions={actions(async () => ({ ok: true as const, password: "pw1" }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Wifi: Example-Guest / pw1"));
    expect((await screen.findByRole("status")).textContent).toContain("Copied");
  });

  it("shows an add form when empty", () => {
    render(<WifiSection networks={[]} actions={actions(async () => ({ ok: true as const, password: "" }))} />);
    expect(screen.getByText("No wifi network saved yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add network" })).toBeTruthy();
  });
});
