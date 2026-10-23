// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentForm } from "@/components/documents/DocumentForm";
import { DocumentsCard } from "@/components/home/DocumentsCard";
import { daysUntil, expiringSoon, sanitiseFilename, sniffMime, validSize, verifyMime } from "@/components/documents/files";
import { DEFAULT_DATE_PREFS } from "@/components/dates";
import { EXPIRY_WARNING_DAYS, type VaultDocument } from "@/components/documents/types";

afterEach(cleanup);

let n = 0;
const doc = (o: Partial<VaultDocument>): VaultDocument => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  household_id: "22222222-2222-4222-8222-222222222222",
  title: "Doc", category: "other", mime_type: "application/pdf", size_bytes: 10,
  issued_on: null, expires_on: null, renewal_date: null, record_id: null, notes: null,
  created_at: "2026-10-01T10:00:00Z", ...o,
});
const noop = async () => null;
const today = new Date(2026, 9, 21);

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const HEIC = new TextEncoder().encode("\0\0\0\x18ftypheic\0\0\0\0");

describe("mime and magic bytes", () => {
  it("sniffs each supported type", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPG)).toBe("image/jpeg");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(HEIC)).toBe("image/heic");
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffMime(new Uint8Array())).toBeNull();
  });
  it("requires declared type and bytes to agree", () => {
    expect(verifyMime("application/pdf", PDF)).toBe("application/pdf");
    expect(verifyMime("image/jpg", JPG)).toBe("image/jpeg");
    expect(verifyMime("image/png", PDF)).toBeNull();
    expect(verifyMime("application/pdf", new TextEncoder().encode("hello world!!"))).toBeNull();
    expect(verifyMime("text/html", PDF)).toBeNull();
  });
  it("limits size to 20 MB", () => {
    expect(validSize(1)).toBe(true);
    expect(validSize(20 * 1024 * 1024)).toBe(true);
    expect(validSize(20 * 1024 * 1024 + 1)).toBe(false);
    expect(validSize(0)).toBe(false);
  });
});

describe("sanitiseFilename", () => {
  it("keeps only safe characters and strips paths", () => {
    expect(sanitiseFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitiseFilename("My deed (final).pdf")).toBe("My_deed_final_.pdf");
    expect(sanitiseFilename("..hidden")).toBe("hidden");
    expect(sanitiseFilename("???")).toBe("file");
    expect(sanitiseFilename("")).toBe("file");
  });
  it("caps at 100 characters and keeps the extension", () => {
    const out = sanitiseFilename(`${"a".repeat(300)}.pdf`);
    expect(out.length).toBe(100);
    expect(out.endsWith(".pdf")).toBe(true);
    expect(sanitiseFilename("a".repeat(300)).length).toBe(100);
  });
});

describe("expiry", () => {
  it("counts days and finds expiring documents", () => {
    expect(daysUntil("2026-10-31", today)).toBe(10);
    expect(daysUntil("2026-10-20", today)).toBe(-1);
    expect(daysUntil(null, today)).toBeNull();
    const docs = [
      doc({ title: "far", expires_on: "2027-06-01" }),
      doc({ title: "soon", expires_on: "2026-11-10" }),
      doc({ title: "past", expires_on: "2026-09-01" }),
      doc({ title: "none" }),
    ];
    expect(expiringSoon(docs, today).map((d) => d.title)).toEqual(["past", "soon"]);
    // Same 30-day window as the traffic light: 40 days out is not "expiring soon".
    expect(expiringSoon([doc({ title: "later", expires_on: "2026-11-30" })], today)).toEqual([]);
    expect(expiringSoon([doc({ title: "edge", expires_on: "2026-11-20" })], today).map((d) => d.title)).toEqual(["edge"]);
    expect(EXPIRY_WARNING_DAYS).toBe(30);
  });
});

describe("DocumentList", () => {
  it("groups by category, badges expiring and expired, never shows storage paths", () => {
    const { container } = render(
      <DocumentList
        remove={noop}
        datePrefs={DEFAULT_DATE_PREFS}
        today={today}
        documents={[
          doc({ title: "Policy", category: "insurance", expires_on: "2026-11-10" }),
          doc({ title: "Old", category: "insurance", expires_on: "2026-01-01" }),
          doc({ title: "Deed", category: "property", expires_on: "2030-01-01" }),
        ]}
      />,
    );
    const groups = screen.getAllByTestId("document-group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Property", "Insurance"]);
    const badges = screen.getAllByTestId("expiry-badge").map((b) => b.textContent);
    expect(badges[0]).toContain("Expires 10/Nov/2026");
    expect(badges[1]).toContain("Expired 01/Jan/2026");
    expect(badges[0]).toContain("Due soon");
    expect(badges[1]).toContain("Overdue");
    expect(within(groups[0]!).getByText("On track")).toBeTruthy();
    expect(within(groups[0]!).queryByTestId("expiry-badge")).toBeNull();
    const links = screen.getAllByRole("link", { name: "Open" }).map((a) => a.getAttribute("href"));
    expect(links.every((h) => /^\/documents\/[0-9a-f-]{36}\/open$/.test(h ?? ""))).toBe(true);
    expect(container.innerHTML).not.toMatch(/storage|signed|token=/i);
  });
  it("shows an empty state", () => {
    render(<DocumentList remove={noop} datePrefs={DEFAULT_DATE_PREFS} documents={[]} />);
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
  });
});

describe("DocumentForm", () => {
  it("offers categories, dates and records to link", () => {
    render(<DocumentForm action={noop} records={[{ id: "4ec10000-0000-4000-8000-000000000001", title: "Home insurance" }]} />);
    expect(screen.getByLabelText(/File/)).toBeTruthy();
    expect(screen.getByLabelText("Expires on")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Home insurance" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Warranty" })).toBeTruthy();
  });
});

describe("DocumentsCard", () => {
  it("shows count and expiring soon", () => {
    render(<DocumentsCard datePrefs={DEFAULT_DATE_PREFS} summary={{ count: 3, expiring: [doc({ title: "Policy", expires_on: "2026-11-10" })] }} />);
    expect(screen.getByText("3 documents stored")).toBeTruthy();
    expect(screen.getByText(/Policy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open documents" }).getAttribute("href")).toBe("/documents");
  });
  it("handles load failure", () => {
    render(<DocumentsCard datePrefs={DEFAULT_DATE_PREFS} summary={null} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
