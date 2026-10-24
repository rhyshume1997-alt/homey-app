export interface NavItem {
  label: string;
  href: string;
  /** Only routes that exist may be available. Others render as disabled. */
  available: boolean;
  icon: "home" | "tasks" | "snags" | "money" | "gear";
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Home", href: "/", available: true, icon: "home" },
  { label: "Chores", href: "/tasks", available: true, icon: "tasks" },
  { label: "Snags", href: "/snags", available: true, icon: "snags" },
  { label: "Money", href: "/money", available: true, icon: "money" },
  { label: "Settings", href: "/settings", available: true, icon: "gear" },
];
