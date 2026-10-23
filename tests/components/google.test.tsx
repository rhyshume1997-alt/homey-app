// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GoogleStatus, noticeFor } from "../../src/app/(house)/settings/google/GoogleStatus";
import { SyncButton } from "@/components/replies/SyncButton";
import { GMAIL_SCOPE, SHEETS_SCOPE } from "@/server/integrations/google/scopes";

afterEach(cleanup);
const disconnect = vi.fn(async () => undefined);

describe("GoogleStatus", () => {
  it("not connected: shows No, Connect Google and the read-only explanation, no Disconnect", () => {
    render(<GoogleStatus connection={{ connected: false, scopes: "", updatedAt: null }} notice={null} disconnect={disconnect} />);
    expect(screen.getByTestId("connected").textContent).toBe("No");
    expect(screen.getByRole("link", { name: "Connect Google" }).getAttribute("href")).toBe("/auth/google/connect");
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByText(/Read-only\./)).toBeTruthy();
  });

  it("connected: shows scopes, time, Reconnect and Disconnect", () => {
    render(<GoogleStatus connection={{ connected: true, scopes: `${SHEETS_SCOPE} ${GMAIL_SCOPE}`, updatedAt: "21 Oct 2026 12:00" }} notice={null} disconnect={disconnect} />);
    expect(screen.getByTestId("connected").textContent).toBe("Yes");
    expect(screen.getByTestId("scopes").textContent).toBe("Read the costs sheet, Read Gmail (metadata used)");
    expect(screen.getByText("21 Oct 2026 12:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconnect Google" })).toBeTruthy();
  });

  it("shows only the granted scope", () => {
    render(<GoogleStatus connection={{ connected: true, scopes: SHEETS_SCOPE, updatedAt: null }} notice={null} disconnect={disconnect} />);
    expect(screen.getByTestId("scopes").textContent).toBe("Read the costs sheet");
  });

  it("maps notices from fixed codes only", () => {
    expect(noticeFor({ connected: "1" })?.error).toBe(false);
    expect(noticeFor({ error: "failed" })?.error).toBe(true);
    expect(noticeFor({ error: "<script>alert(1)</script>" })).toBeNull();
    render(<GoogleStatus connection={{ connected: false, scopes: "", updatedAt: null }} notice={noticeFor({ error: "scopes" })} disconnect={disconnect} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Tick both boxes/);
  });
});

describe("SyncButton", () => {
  it("connected users get a Sync from Gmail button", () => {
    render(<SyncButton action={async () => ({ ok: true })} connected />);
    expect(screen.getByRole("button", { name: "Sync from Gmail" })).toBeTruthy();
  });
  it("others get a link to connect", () => {
    render(<SyncButton action={async () => ({ ok: true })} connected={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/google");
  });
});
