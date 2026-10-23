import Link from "next/link";
import { GlassIcon, type IconName, type Tint } from "@/components/ui/GlassIcon";

export type MoreTile = {
  href: string;
  label: string;
  icon: IconName;
};

export type MoreGroup = {
  id: string;
  title: string;
  tint: Tint;
  tiles: readonly MoreTile[];
};

/**
 * Hub links shown on the More page. Icons are the closest existing GlassIcon names;
 * see the report for the fallbacks used.
 */
export const MORE_GROUPS: readonly MoreGroup[] = [
  {
    id: "household",
    title: "Household",
    tint: "lavender",
    tiles: [
      { href: "/rooms", label: "Rooms", icon: "room" },
      { href: "/things-to-get", label: "Things to get", icon: "star" },
      { href: "/checklist", label: "Seasonal checklist", icon: "checklist" },
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/shopping", label: "Shopping", icon: "cart" },
      { href: "/meals", label: "Meals", icon: "meal" },
      { href: "/bins", label: "Bins", icon: "bins" },
      { href: "/maintenance", label: "Maintenance", icon: "wrench" },
      { href: "/appliances", label: "Appliances", icon: "appliance" },
    ],
  },
  {
    id: "money-home",
    title: "Money and home",
    tint: "amber",
    tiles: [
      { href: "/budget", label: "Costs sheet", icon: "money" },
      { href: "/money/check", label: "Check figures", icon: "checklist" },
      { href: "/house", label: "House", icon: "house-heart" },
      { href: "/mortgage", label: "Mortgage", icon: "money" },
      { href: "/contacts", label: "Contacts", icon: "people" },
      { href: "/energy", label: "Energy", icon: "bolt" },
      { href: "/documents", label: "Documents", icon: "document" },
    ],
  },
  {
    id: "safety-guests",
    title: "Safety and guests",
    tint: "rose",
    tiles: [
      { href: "/emergency", label: "Emergency card", icon: "shield" },
      { href: "/wifi", label: "Guest wifi", icon: "wifi" },
    ],
  },
  {
    id: "inbox",
    title: "Inbox",
    tint: "blue",
    tiles: [
      { href: "/replies", label: "Awaiting replies", icon: "mail" },
      { href: "/notifications", label: "Notifications", icon: "bell" },
    ],
  },
  {
    id: "homey-chat",
    title: "Homey",
    tint: "homey",
    tiles: [{ href: "/assistant", label: "Homey chat", icon: "sparkle" }],
  },
];

const tileCls =
  "flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 py-3 text-center text-sm font-medium leading-tight shadow-sm transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2";

/** Responsive grid of glass tiles: 3 per row on phones, 4 on small tablets, 5 on desktop. */
export function MoreHub({ groups = MORE_GROUPS }: { groups?: readonly MoreGroup[] }) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <nav key={g.id} aria-labelledby={`${g.id}-links-heading`} className="flex flex-col gap-2">
          <h2 id={`${g.id}-links-heading`} className="text-lg font-semibold">
            {g.title}
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {g.tiles.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className={tileCls}>
                  <GlassIcon name={t.icon} tint={g.tint} size="lg" />
                  <span>{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </div>
  );
}
