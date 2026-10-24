// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomeyPanel, greetingFor, type HomeyPanelProps } from "@/components/homey/HomeyPanel";
import type { NeedItem } from "@/components/homey/types";

afterEach(cleanup);

const items: NeedItem[] = [
  { key: "kudos:1", bucket: "activity", kind: "activity", light: "green", text: "Sam emptied the dishwasher", href: "/activity", action: { type: "draft_thanks", label: "Draft thanks" } },
  { key: "task:1", bucket: "overdue", kind: "task", light: "red", text: "Fix the tap", href: "/tasks", action: { type: "open", href: "/tasks", label: "Open" } },
  { key: "renewal:1", bucket: "soon", kind: "renewal", light: "amber", text: "Gas tariff renewal", href: "/money", action: { type: "propose_task", label: "Add task" } },
  { key: "supplies", bucket: "check", kind: "supplies", light: "amber", text: "Check bin bags", href: "/shopping", action: { type: "propose_shopping", label: "Shopping" } },
] as NeedItem[];

function setup(over: Partial<HomeyPanelProps> = {}) {
  const props: HomeyPanelProps = {
    open: true,
    onClose: vi.fn(),
    firstName: "Alex",
    otherName: "Sam",
    items,
    digest: { summary: "Gas renewal is due soon.", top: [], createdAt: "2026-10-22T07:12:00Z", stale: false },
    spend: { used: 0.04, cap: 5 },
    face: (e, s, m) => <span data-testid="face" data-greet={m?.greet ? "true" : undefined} data-talking={m?.talking ? "true" : undefined}>{`${e}:${s}`}</span>,
    onRefresh: vi.fn(),
    onPropose: vi.fn().mockResolvedValue({ proposalId: "p1", text: "Add task: Review Gas tariff renewal (due 29 Oct)" }),
    onConfirm: vi.fn().mockResolvedValue({ ok: true }),
    onReject: vi.fn().mockResolvedValue({ ok: true }),
    onDraftThanks: vi.fn().mockResolvedValue({ draft: "Thanks for the dishwasher!" }),
    onSendThanks: vi.fn().mockResolvedValue({ ok: true }),
    now: new Date("2026-10-22T07:30:00Z"),
    ...over,
  };
  render(<HomeyPanel {...props} />);
  return props;
}
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe("HomeyPanel", () => {
  it("renders dialog, title, greeting, digest and sections in order", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "What needs doing today" }).getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Morning Alex!")).toBeTruthy();
    expect(screen.getByTestId("digest").textContent).toContain("AI summary · 08:12");
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(["From Sam today", "Overdue", "Due soon", "Worth checking"]);
    expect(screen.getByText("£0.04 of £5.00 used", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open chat/ }).getAttribute("href")).toBe("/assistant");
  });

  it("greets by London time of day", () => {
    expect(greetingFor(new Date("2026-10-22T16:00:00Z"), "Alex")).toBe("Afternoon Alex!");
    expect(greetingFor(new Date("2026-10-22T21:00:00Z"), "Alex")).toBe("Evening Alex!");
  });

  it("hides digest when null, shows stale refresh and calls onRefresh", async () => {
    cleanup();
    setup({ digest: null });
    expect(screen.queryByTestId("digest")).toBeNull();
    cleanup();
    const p = setup({ digest: { summary: "x", top: [], createdAt: "2026-10-22T07:12:00Z", stale: true } });
    await click(screen.getByRole("button", { name: "List changed: refresh" }));
    expect(p.onRefresh).toHaveBeenCalled();
  });

  it("closes via Escape, backdrop and X", () => {
    const p = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTestId("homey-backdrop"));
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it("traps focus on Tab from the last element", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    const last = within(dialog).getByRole("link", { name: /Open chat/ });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
  });

  it("propose then confirm", async () => {
    const p = setup();
    await click(screen.getByRole("button", { name: "+ Add task" }));
    expect(p.onPropose).toHaveBeenCalledWith("renewal:1");
    expect(screen.getByTestId("proposal-strip").textContent).toContain("Add task: Review Gas tariff renewal (due 29 Oct)");
    await click(screen.getByRole("button", { name: "Confirm" }));
    expect(p.onConfirm).toHaveBeenCalledWith("p1");
    expect(p.onReject).not.toHaveBeenCalled();
  });

  it("propose then cancel, and shopping action", async () => {
    const p = setup();
    await click(screen.getByRole("button", { name: "+ Shopping" }));
    expect(p.onPropose).toHaveBeenCalledWith("supplies");
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onReject).toHaveBeenCalledWith("p1");
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it("shows propose error", async () => {
    setup({ onPropose: vi.fn().mockResolvedValue({ error: "Not allowed" }) });
    await click(screen.getByRole("button", { name: "+ Add task" }));
    expect(screen.getByRole("alert").textContent).toBe("Not allowed");
  });

  it("draft thanks, edit, send", async () => {
    const p = setup();
    await click(screen.getByRole("button", { name: "Draft thanks" }));
    expect(p.onDraftThanks).toHaveBeenCalledWith("kudos:1");
    expect(screen.getByText("Thanks for the dishwasher!")).toBeTruthy();
    await click(screen.getByRole("button", { name: "Edit" }));
    const ta = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(200);
    fireEvent.change(ta, { target: { value: "Cheers!" } });
    await click(screen.getByRole("button", { name: "Send in app" }));
    expect(p.onSendThanks).toHaveBeenCalledWith("kudos:1", "Cheers!");
  });

  it("draft thanks send unedited and Not now", async () => {
    const p = setup();
    await click(screen.getByRole("button", { name: "Draft thanks" }));
    await click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("draft-strip")).toBeNull();
    await click(screen.getByRole("button", { name: "Draft thanks" }));
    await click(screen.getByRole("button", { name: "Send in app" }));
    expect(p.onSendThanks).toHaveBeenCalledWith("kudos:1", "Thanks for the dishwasher!");
  });

  it("open action is a link", () => {
    setup();
    expect(screen.getByRole("link", { name: /^Open\s*›?$/ }).getAttribute("href")).toBe("/tasks");
  });

  it("empty state with happy face and partial notice", () => {
    setup({ items: [], partial: true });
    expect(screen.getByText("Nothing pressing today. Nice one!")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("could not be loaded");
    expect(screen.getByTestId("face").textContent).toBe("happy:56");
  });

  it("first open content", async () => {
    const onShow = vi.fn();
    const onDismiss = vi.fn();
    setup({ firstOpen: true, onFirstOpenShow: onShow, onFirstOpenDismiss: onDismiss });
    expect(screen.getByText(/Hello, I.m your Homey/)).toBeTruthy();
    expect(screen.getByText(/Nothing changes until you tap Confirm/)).toBeTruthy();
    await click(screen.getByRole("button", { name: "Show me today" }));
    await click(screen.getByRole("button", { name: "Not now" }));
    expect(onShow).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("HomeyPanel face moments", () => {
  it("waves when the panel opens, without talking", () => {
    setup();
    const face = screen.getByTestId("face");
    expect(face.getAttribute("data-greet")).toBe("true");
    expect(face.hasAttribute("data-talking")).toBe(false);
  });

  it("talks while the AI summary is being worked out", () => {
    setup({ thinking: true });
    expect(screen.getByTestId("face").getAttribute("data-talking")).toBe("true");
  });
});
