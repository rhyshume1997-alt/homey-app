"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import { NavIcon } from "./NavIcon";

/** Renders one nav list. `variant` switches between bottom tab bar and sidebar. */
export function AppNav({ variant }: { variant: "tabs" | "sidebar" }) {
  const pathname = usePathname();
  const isTabs = variant === "tabs";

  const base = isTabs
    ? "flex min-h-[var(--touch-target)] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs"
    : "flex min-h-[var(--touch-target)] items-center gap-3 rounded-md px-3 py-2 text-base";

  return (
    <nav
      aria-label={isTabs ? "Main" : "Main sidebar"}
      className={
        isTabs
          ? "fixed inset-x-0 bottom-0 z-30 frosted border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
          : "hidden lg:block"
      }
    >
      <ul className={isTabs ? "flex h-[var(--tabbar-height)] items-stretch" : "flex flex-col gap-1"}>
        {NAV_ITEMS.map((item) => {
          const active = item.available && pathname === item.href;
          return (
            <li key={item.href} className={isTabs ? "flex flex-1" : ""}>
              {item.available ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${base} ${isTabs ? "w-full" : "w-full"} ${
                    active
                      ? `font-semibold text-foreground ${isTabs ? "" : "bg-accent-soft"}`
                      : isTabs ? "text-muted" : "text-foreground"
                  }`}
                >
                  <NavIcon name={item.icon} active={active} />
                  <span>{item.label}</span>
                </Link>
              ) : (
                <span
                  role="link"
                  aria-disabled="true"
                  className={`${base} w-full cursor-not-allowed text-muted opacity-80`}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                  <span className={isTabs ? "sr-only" : "ml-auto text-xs"}>
                    {isTabs ? " (Coming soon)" : "Coming soon"}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
