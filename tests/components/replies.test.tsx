// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RepliesList } from "@/components/replies/RepliesList";
import { AwaitingRepliesCard } from "@/components/home/AwaitingRepliesCard";
import { daysWaiting, type EmailThread } from "@/components/replies/types";

afterEach(cleanup);

const NOW = new Date("2026-10-21T12:00:00Z");
let n = 0;
const thread = (o: Partial<EmailThread>): EmailThread => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  thread_hash: "a".repeat(64), member: "Alex", subject: "Refund", counterpart_domain: "natwest.com",
  last_message_at: "2026-10-11T09:00:00Z", last_from: "me", labelled: false, status: "awaiting",
  updated_at: "2026-10-11T09:00:00Z", ...o,
});
const noop = async () => null;
const actions = { close: noop, reopen: noop };

describe("daysWaiting", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysWaiting("2026-10-11T12:00:00Z", NOW)).toBe(10);
    expect(daysWaiting("2026-10-22T12:00:00Z", NOW)).toBe(0);
    expect(daysWaiting("nope", NOW)).toBe(0);
  });
});

describe("RepliesList", () => {
  it("shows days waiting, domain, subject and member, with Mark closed", () => {
    render(<RepliesList threads={[thread({})]} now={NOW} actions={actions} />);
    const row = screen.getByTestId("reply-row");
    expect(within(row).getByText("natwest.com")).toBeTruthy();
    expect(within(row).getByText(/waiting 10 days/)).toBeTruthy();
    expect(within(row).getByText("Refund")).toBeTruthy();
    expect(within(row).getByText(/Alex/)).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Mark closed" })).toBeTruthy();
  });
  it("collapses replied, offers Reopen on closed", () => {
    const { container } = render(
      <RepliesList threads={[thread({ status: "replied", last_from: "them" }), thread({ status: "closed" })]} now={NOW} actions={actions} />,
    );
    const details = container.querySelectorAll("details");
    expect(details.length).toBe(2);
    details.forEach((d) => expect(d.hasAttribute("open")).toBe(false));
    expect(screen.getByRole("button", { name: "Reopen", hidden: true })).toBeTruthy();
  });
  it("says not connected when there are no rows", () => {
    render(<RepliesList threads={[]} now={NOW} actions={actions} />);
    expect(screen.getByText(/Not connected yet/)).toBeTruthy();
  });
});

describe("AwaitingRepliesCard", () => {
  it("shows Not connected yet before any sync", () => {
    render(<AwaitingRepliesCard data={{ count: 0, top: [], everSynced: false }} now={NOW} />);
    expect(screen.getByText("Not connected yet")).toBeTruthy();
  });
  it("shows the count and at most three threads", () => {
    const top = [1, 2, 3, 4].map((i) => thread({ counterpart_domain: `c${i}.com` }));
    render(<AwaitingRepliesCard data={{ count: 4, top, everSynced: true }} now={NOW} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(3);
  });
  it("shows an error note when unavailable", () => {
    render(<AwaitingRepliesCard data={null} now={NOW} />);
    expect(screen.getByText("Could not load this right now.")).toBeTruthy();
  });
});
