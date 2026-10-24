"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "our-home:nav-stack";
const MAX = 30;

/** Parent of an in-app path ("/money/check" -> "/money"). Always a same-origin, root-relative path. */
export function parentPath(pathname: string): string {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) {
    return "/";
  }
  const parts = pathname.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? "/" + parts.join("/") : "/";
}

function readStack(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    // Storage unavailable: Back falls back to the parent page.
  }
}

export function BackButton({ className = "inline-flex" }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stack = readStack();
    if (stack[stack.length - 1] === pathname) return;
    if (stack.length >= 2 && stack[stack.length - 2] === pathname) stack.pop();
    else stack.push(pathname);
    writeStack(stack);
  }, [pathname]);

  if (pathname === "/") return null;

  function onClick() {
    const stack = readStack();
    if (stack.length >= 2 && stack[stack.length - 1] === pathname) router.back();
    else router.push(parentPath(pathname));
  }

  return (
    <button
      type="button"
      aria-label="Back"
      onClick={onClick}
      className={`min-h-11 min-w-11 items-center justify-center gap-1 rounded-md pr-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
      <span>Back</span>
    </button>
  );
}
