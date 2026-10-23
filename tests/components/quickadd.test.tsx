// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ logEventAction: vi.fn(), quickAddTaskAction: vi.fn(), quickAddSnagAction: vi.fn() }));
vi.mock("@/app/(house)/quick-add-actions", () => mocks);

import { QuickAdd } from "@/components/QuickAdd";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});
afterEach(cleanup);

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /quick add/i }));

describe("QuickAdd actions", () => {
  it("logs an event by slug only, closes, and confirms", async () => {
    mocks.logEventAction.mockResolvedValue({ ok: true });
    render(<QuickAdd />);
    openDialog();
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: " gentle cycle " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Put a washing on" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const fd = mocks.logEventAction.mock.calls[0]![1] as FormData;
    expect(fd.get("slug")).toBe("washing.on");
    expect([...fd.keys()].sort()).toEqual(["note", "slug"]);
    expect(screen.getByRole("status").textContent).toBe("Logged: Put a washing on");
  });

  it("shows a fixed error and stays open when logging fails", async () => {
    mocks.logEventAction.mockResolvedValue({ error: "Could not log that. Please try again." });
    render(<QuickAdd />);
    openDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bought supplies" }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Could not log that. Please try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("adds a task with a title-only form", async () => {
    mocks.quickAddTaskAction.mockResolvedValue({ ok: true });
    render(<QuickAdd />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Bins" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((mocks.quickAddTaskAction.mock.calls[0]![1] as FormData).get("title")).toBe("Bins");
    expect(screen.getByRole("status").textContent).toBe("Task added");
  });

  it("adds a snag and Back returns to the menu", async () => {
    mocks.quickAddSnagAction.mockResolvedValue({ ok: true });
    render(<QuickAdd />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add a snag" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a snag" }));
    fireEvent.change(screen.getByLabelText("Snag title"), { target: { value: "Loose tile" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add snag" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Snag added");
  });

  it("offers link tiles and announces homey:avoid on open and close", () => {
    const seen: boolean[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent).detail.open);
    window.addEventListener("homey:avoid", h);
    render(<QuickAdd />);
    openDialog();
    expect(screen.getByRole("link", { name: "Bill or renewal" }).getAttribute("href")).toBe("/money");
    expect(screen.getByRole("link", { name: "Meter reading" }).getAttribute("href")).toBe("/energy#readings");
    expect(screen.getByRole("link", { name: "Thing to get" }).getAttribute("href")).toBe("/things-to-get#new");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    window.removeEventListener("homey:avoid", h);
    expect(seen).toEqual([true, false]);
  });
});
