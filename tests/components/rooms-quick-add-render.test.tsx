// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QuickAddRooms } from "@/components/rooms/QuickAddRooms";
import type { FormAction } from "@/components/tasks/types";

afterEach(cleanup);

const noop = vi.fn(async () => null);

describe("QuickAddRooms", () => {
  it("leads an empty household with the question and all eleven chips", () => {
    render(<QuickAddRooms names={[]} action={noop} />);
    expect(screen.getByRole("heading", { name: "Which rooms do you have?" })).toBeTruthy();
    expect(screen.getByText("Tap to add, you can rename or remove them later.")).toBeTruthy();
    const group = screen.getByRole("heading", { name: "Which rooms do you have?" }).closest("section")!;
    expect(within(group).getAllByRole("button")).toHaveLength(11);
  });

  it("hides chips for rooms already present and numbers Bedroom", () => {
    render(<QuickAddRooms names={["kitchen", "Bedroom"]} action={noop} />);
    expect(screen.getByRole("heading", { name: "Quick add" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kitchen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bedroom 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bedroom" })).toBeNull();
    expect(screen.getByRole("button", { name: "Living room" })).toBeTruthy();
  });

  it("gives every chip a 44px touch target", () => {
    render(<QuickAddRooms names={[]} action={noop} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("min-h-[var(--touch-target)]");
    }
  });

  it("posts the chip's name to the create action when tapped", async () => {
    const action = vi.fn<FormAction>(async () => null);
    render(<QuickAddRooms names={[]} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Garden" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const fd = action.mock.calls[0][1];
    expect(fd.get("name")).toBe("Garden");
  });
});
