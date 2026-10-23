// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApplianceDraft, ReadingDraft } from "@/contracts/email-import";
import { ApplianceImportReview } from "@/components/import/ApplianceImportReview";
import { ReadingImportReview } from "@/components/import/ReadingImportReview";
import { ConnectGoogleNotice } from "@/components/import/shared";

afterEach(cleanup);

const source = (sender: "Bosch" | "E.ON", subject: string) => ({
  sender, domain: sender === "Bosch" ? "bosch-home.co.uk" : "eonnext.com", receivedAt: "2024-11-14T10:00:00.000Z", subject, messageHash: "a".repeat(64),
});

const appliance = (o: Partial<ApplianceDraft> = {}): ApplianceDraft => ({
  messageId: "18c2fa0001",
  source: source("Bosch", "Order confirmation"),
  kind: "order",
  fields: { make: "Bosch", model: "SMS6ZCI49E", productName: null, purchaseDate: "2024-11-14", warrantyEnd: "2026-11-14", warrantyComputed: true, warrantyYears: 2 },
  found: { model: true, productName: false, purchaseDate: true, warrantyEnd: false, warrantyYears: true },
  modelOptions: [],
  ...o,
});

const reading = (o: Partial<ReadingDraft> = {}): ReadingDraft => ({
  messageId: "18c2fb0001",
  source: source("E.ON", "Reading confirmation"),
  kind: "reading",
  fields: { readingDate: null, electricity: [{ register: "day", kwh: 4567 }, { register: "night", kwh: 2345 }], gas: { value: 1234, unit: null }, meterType: "economy7" },
  found: { readingDate: false, electricity: true, gas: true, gasUnit: false, meterType: true, estimatedSkipped: true, ambiguous: false },
  ...o,
});

describe("ConnectGoogleNotice", () => {
  it("tells the member to connect Google in More", () => {
    render(<ConnectGoogleNotice />);
    expect(screen.getByText("Connect Google in More to import from email")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/settings/google");
  });
});

describe("ApplianceImportReview", () => {
  it("shows editable draft fields, the source and the computed-warranty note", () => {
    render(<ApplianceImportReview drafts={[appliance(), appliance({ messageId: "18c2fa0002" })]} action={vi.fn()} />);
    expect(screen.getAllByText(/Bosch · Order confirmation/)).toHaveLength(2);
    expect(screen.getAllByText(/1 of 2 candidates|2 of 2 candidates/)).toHaveLength(2);
    expect((screen.getAllByLabelText(/^Model/)[0] as HTMLInputElement).value).toBe("SMS6ZCI49E");
    expect((screen.getAllByLabelText(/^Make/)[0] as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getAllByLabelText(/^Warranty end/)[0] as HTMLInputElement).value).toBe("2026-11-14");
    expect(screen.getAllByText(/Worked out from '2 year guarantee'/)).toHaveLength(2);
    expect(screen.getAllByText("Not found in the email.").length).toBeGreaterThan(0); // product name
    expect(screen.getByText(/Nothing is saved yet/)).toBeTruthy();
  });

  it("lists model options instead of guessing", () => {
    render(<ApplianceImportReview drafts={[appliance({ fields: { ...appliance().fields, model: null }, found: { ...appliance().found, model: false }, modelOptions: ["SMS6ZCI49E", "WGG254Z0GB"] })]} action={vi.fn()} />);
    expect(screen.getByText(/Several models in the email: SMS6ZCI49E, WGG254Z0GB/)).toBeTruthy();
    expect((screen.getByLabelText(/^Model/) as HTMLInputElement).value).toBe("");
  });

  it("Discard hides the draft without calling the server", () => {
    const action = vi.fn();
    render(<ApplianceImportReview drafts={[appliance()]} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("No appliance emails to review.")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("Save posts the message id and editable fields, then hides the draft", async () => {
    const action = vi.fn(async () => ({ ok: true }));
    render(<ApplianceImportReview drafts={[appliance()]} action={action} />);
    fireEvent.change(screen.getByLabelText(/^Room/), { target: { value: "Kitchen" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save appliance" }));
    });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("messageId")).toBe("18c2fa0001");
    expect(fd.get("model")).toBe("SMS6ZCI49E");
    expect(fd.get("room")).toBe("Kitchen");
    expect(fd.get("make")).toBeNull();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved 1 appliance."));
  });

  it("shows a save error and keeps the draft", async () => {
    const action = vi.fn(async () => ({ error: "Add a model or product name before saving." }));
    render(<ApplianceImportReview drafts={[appliance()]} action={action} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save appliance" }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Add a model/));
    expect(screen.getByRole("button", { name: "Save appliance" })).toBeTruthy();
  });
});

describe("ReadingImportReview", () => {
  it("shows the registers found, empty date to fill in, gas unit to choose and notes", () => {
    render(<ReadingImportReview drafts={[reading()]} action={vi.fn()} />);
    expect((screen.getByLabelText(/^Electricity day/) as HTMLInputElement).value).toBe("4567");
    expect((screen.getByLabelText(/^Electricity night/) as HTMLInputElement).value).toBe("2345");
    expect(screen.queryByLabelText(/^Electricity \(kWh\)/)).toBeNull();
    expect((screen.getByLabelText(/^Reading date/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^Gas unit/) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Unit not stated in the email.")).toBeTruthy();
    expect(screen.getByText("Meter: Economy 7")).toBeTruthy();
    expect(screen.getByText(/Estimated readings in the email were left out/)).toBeTruthy();
    expect(screen.getByText(/Only confirmed readings are charted/)).toBeTruthy();
  });

  it("Discard and Save", async () => {
    const action = vi.fn(async () => ({ ok: true }));
    render(<ReadingImportReview drafts={[reading(), reading({ messageId: "18c2fb0002" })]} action={action} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]!);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save readings" }));
    });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("messageId")).toBe("18c2fb0002");
    expect(fd.get("elecDay")).toBe("4567");
    await waitFor(() => expect(screen.getByText("No meter reading emails to review.")).toBeTruthy());
  });
});
