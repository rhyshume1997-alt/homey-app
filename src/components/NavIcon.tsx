import type { NavItem } from "./nav-items";
import { GlassIcon, LineIcon } from "./ui/GlassIcon";

/** Active tab: glass tile. Inactive: plain line icon in the current (muted) colour. Always decorative. */
export function NavIcon({ name, active = false }: { name: NavItem["icon"]; active?: boolean }) {
  return active ? <GlassIcon name={name} tint="lavender" size="sm" /> : <LineIcon name={name} />;
}
