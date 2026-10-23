import type { HouseholdRole } from "@/contracts/household";

export type MemberView = {
  displayName: string;
  role: HouseholdRole;
};

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Owner",
  member: "Member",
};

/** Household members, name and role only. Pure: all data arrives as props. */
export function MembersList({
  members,
  error,
}: {
  members: readonly MemberView[];
  error?: boolean;
}) {
  if (error) return <p className="text-sm text-muted">Could not load household members. Try again shortly.</p>;
  if (members.length === 0) return <p className="text-sm text-muted">No household members found.</p>;
  return (
    <ul aria-label="Household members" className="flex flex-col gap-2">
      {members.map((m, i) => (
        <li
          key={`${m.displayName}-${i}`}
          className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2 text-sm"
        >
          <span className="font-medium">{m.displayName}</span>
          <span className="text-xs text-muted">{ROLE_LABELS[m.role]}</span>
        </li>
      ))}
    </ul>
  );
}
