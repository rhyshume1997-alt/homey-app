// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MembersManager } from "@/components/household/MembersManager";
import { HouseholdSwitcher } from "@/components/household/HouseholdSwitcher";
import { CreateHouseholdForm, JoinHouseholdForm } from "@/components/household/OnboardingForms";

afterEach(cleanup);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const noop = vi.fn(async () => null);
const actions = () => ({ invite: vi.fn(async () => null), revoke: vi.fn(async () => null), remove: vi.fn(async () => null), leave: vi.fn(async () => null) });
const members = [
  { userId: U1, displayName: "Owner One", role: "owner" as const },
  { userId: U2, displayName: "Member Two", role: "member" as const },
];

describe("MembersManager", () => {
  it("owner sees invite form, pending invites with expiry and Revoke, and Remove for others only", () => {
    render(
      <MembersManager members={members} invites={[{ id: U2, email: "x@y.co", expiresLabel: "1 Nov 2026" }]} selfUserId={U1} isOwner actions={actions()} />,
    );
    expect(screen.getByLabelText("Invite by email")).toBeTruthy();
    expect(screen.getByText("x@y.co")).toBeTruthy();
    expect(screen.getByText("Expires 1 Nov 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Member Two" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Owner One" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave household" })).toBeTruthy();
  });

  it("a plain member gets no management controls but can leave", () => {
    render(<MembersManager members={members} invites={[]} selfUserId={U2} isOwner={false} actions={actions()} />);
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave household" })).toBeTruthy();
  });

  it("remove needs a confirm step before the action runs", async () => {
    const a = actions();
    render(<MembersManager members={members} invites={[]} selfUserId={U1} isOwner actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Member Two" }));
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(a.remove).toHaveBeenCalled());
    const fd = (a.remove.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("user")).toBe(U2);
  });

  it("shows the invite link once, built from the page origin, with a Copy button", async () => {
    const a = actions();
    a.invite = vi.fn(async () => ({ ok: true, message: "Invite created.", token: "TOKEN43" }) as never);
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MembersManager members={members} invites={[]} selfUserId={U1} isOwner actions={a} />);
    fireEvent.change(screen.getByLabelText("Invite by email"), { target: { value: "new@person.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    const box = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(box.value).toBe(`${window.location.origin}/invite/TOKEN43`);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(box.value));
  });

  it("revoke posts the invite id", async () => {
    const a = actions();
    render(<MembersManager members={members} invites={[{ id: U2, email: "x@y.co", expiresLabel: "d" }]} selfUserId={U1} isOwner actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(a.revoke).toHaveBeenCalled());
    expect((a.revoke.mock.calls[0] as unknown as [unknown, FormData])[1].get("invite")).toBe(U2);
  });
});

describe("HouseholdSwitcher", () => {
  const list = [
    { householdId: U1, name: "First", role: "owner" as const },
    { householdId: U2, name: "Second", role: "member" as const },
  ];
  it("renders nothing for a single household", () => {
    const { container } = render(<HouseholdSwitcher memberships={[list[0]]} currentId={U1} action={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
  it("calls the action for the other household and shows server errors", async () => {
    const action = vi.fn(async () => ({ ok: false, message: "You aren't a member of that household." }));
    render(<HouseholdSwitcher memberships={list} currentId={U1} action={action} />);
    expect(screen.getByText("Current")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Second" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(U2));
    expect((await screen.findByRole("alert")).textContent).toMatch(/aren't a member/);
  });
});

describe("onboarding forms", () => {
  it("create form starts empty and submits to the action", async () => {
    const action = vi.fn(async () => ({ ok: false, message: "You've reached the limit of 3 households you can own." }));
    render(<CreateHouseholdForm action={action} />);
    expect((screen.getByLabelText("Household name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Your name in this household") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Household name"), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("Your name in this household"), { target: { value: "Me" } });
    fireEvent.click(screen.getByRole("button", { name: "Create household" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toMatch(/limit of 3/);
  });
  it("join form reveals nothing about the household and submits the display name", async () => {
    const action = vi.fn(async () => ({ ok: false, message: "This invite link isn't valid any more." }));
    render(<JoinHouseholdForm action={action} />);
    fireEvent.change(screen.getByLabelText("Your name in this household"), { target: { value: "Me" } });
    fireEvent.click(screen.getByRole("button", { name: "Join the household" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((action.mock.calls[0] as unknown as [unknown, FormData])[1].get("displayName")).toBe("Me");
  });
});
void noop;
