// @vitest-environment jsdom
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpendMeter } from "@/components/assistant/SpendMeter";
import { AssistantChat } from "@/components/assistant/AssistantChat";

describe("assistant", () => {
  it("shows the spend as a progress bar with amounts", () => {
    render(<SpendMeter spentPence={4} capGbp={5} />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("£0.04 of £5.00")).toBeTruthy();
  });
  it("chat input uses the Homey placeholder", () => {
    render(<AssistantChat send={async () => ({ ok: true, reply: "hi", proposed: 0 })} />);
    expect(screen.getByPlaceholderText("Ask Homey...")).toBeTruthy();
  });
});
afterEach(cleanup);
