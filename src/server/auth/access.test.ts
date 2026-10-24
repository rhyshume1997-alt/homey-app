import { describe, expect, it } from "vitest";
import { decideAccess } from "./access";
import { sanitizeNext } from "./next-param";

const session = { userId: "u1" };

describe("decideAccess", () => {
  it.each([
    "/login",
    "/auth/login",
    "/auth/callback",
    "/_next/static/chunks/main.js",
    "/_next/static/css/a.css",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/manifest.webmanifest",
    "/welcome",
    "/privacy",
    "/terms",
    "/api/health",
    "/api/integrations/bins",
    "/api/integrations/gmail",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/icon.svg",
    "/icons/apple-touch-icon.png",
    "/splash/splash-1179x2556.png",
  ])("allows public path %s without session", (p) => {
    expect(decideAccess(p, null)).toBe("allow");
  });

  it.each([
    "/loginx",
    "/auth/signout",
    "/auth/callbackx",
    "/auth/login/",
    "/auth/callback/",
    "/auth",
    "/login/",
    "/icons",
    "/icons/",
    "/icons/other.png",
    "/icons/icon-192.png/",
    "/login/extra",
    "/login/../x",
    "/Login",
    "/LOGIN",
    "/api/healthz",
    "/api/health/",
    "/api/health/x",
    "/API/health",
    "/favicon.ico/",
    "/robots.txt/x",
    "/_next/static",
    "/_next/static/",
    "/_next/static/../../secret",
    "/_next/static/%2e%2e/secret",
    "/_next/static//x",
    "/_next/staticx/a.js",
    "/_next/image/x",
    "/_next/imagex",
    "/_next/data/build/x.json",
    "/login%2f..%2fx",
    "/login%2F",
    "/%6Cogin",
    "/login\\..\\x",
    "/login\u0000",
    "//login",
    "login",
    "",
    "/",
    "/some/page",
    "/privacy/",
    "/terms/x",
    "/welcomex",
    "/splash/",
    "/splash/other.png",
    "/splash/splash-1179x2556.pngx",
    "/splash/%2e%2e/x",
  ])("does not treat %j as public (page -> redirect)", (p) => {
    expect(decideAccess(p, null)).not.toBe("allow");
  });

  it("returns unauthorized for /api/* and redirect-login for pages", () => {
    expect(decideAccess("/api/anything", null)).toBe("unauthorized");
    expect(decideAccess("/api/healthz", null)).toBe("unauthorized");
    expect(decideAccess("/api/health/", null)).toBe("unauthorized");
    expect(decideAccess("/api", null)).toBe("unauthorized");
    expect(decideAccess("/", null)).toBe("landing");
    expect(decideAccess("/some/page", null)).toBe("redirect-login");
    expect(decideAccess("/loginx", null)).toBe("redirect-login");
    expect(decideAccess("/apix", null)).toBe("redirect-login");
  });

  it("allows everything with a session", () => {
    for (const p of ["/", "/some/page", "/api/anything", "/loginx"]) {
      expect(decideAccess(p, session)).toBe("allow");
    }
  });
});

describe("sanitizeNext", () => {
  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    null,
    undefined,
    "/\tx",
    "/a\\b",
  ])("rejects %j", (v) => {
    expect(sanitizeNext(v as string | null | undefined)).toBeNull();
  });

  it("accepts same-origin relative paths", () => {
    expect(sanitizeNext("/")).toBe("/");
    expect(sanitizeNext("/some/page?a=1")).toBe("/some/page?a=1");
  });
});

describe("decideAccess: onboarding and invites (auth required, membership not required here)", () => {
  const TOKEN = "A".repeat(43);

  it("sends signed-out visitors to login for /onboarding and 401s nothing", () => {
    expect(decideAccess("/onboarding", null)).toBe("redirect-login");
    expect(decideAccess("/onboarding/", null)).toBe("redirect-login");
    expect(decideAccess("/Onboarding", null)).toBe("redirect-login");
  });

  it("allows signed-in people (membership is checked by requireSession, not by the proxy)", () => {
    expect(decideAccess("/onboarding", session)).toBe("allow");
    expect(decideAccess(`/invite/${TOKEN}`, session)).toBe("allow");
  });

  it("lets a well-formed invite link reach its handler signed out (it only sets a cookie and redirects)", () => {
    expect(decideAccess(`/invite/${TOKEN}`, null)).toBe("allow");
    expect(decideAccess(`/invite/${"a-_Z09".repeat(7)}a`, null)).toBe("allow");
  });

  it.each([
    "/invite",
    "/invite/",
    `/invite/${"A".repeat(42)}`,
    `/invite/${"A".repeat(44)}`,
    `/invite/${"A".repeat(43)}/`,
    `/invite/${"A".repeat(43)}/x`,
    `/invite/${"A".repeat(43)}x`,
    `/invite/${"A".repeat(42)}%41`,
    `/invite/${"A".repeat(42)}.`,
    `/invite/${"A".repeat(42)}=`,
    `/invite/${"A".repeat(42)}+`,
    `/invite/${"A".repeat(42)}\\`,
    `/invite/../onboarding`,
    `/invite/..%2fx`,
    `/invite/%2e%2e/${"A".repeat(43)}`,
    `//invite/${"A".repeat(43)}`,
    `/invite//${"A".repeat(43)}`,
    `/Invite/${"A".repeat(43)}`,
    `/invite/${"A".repeat(43)}\u0000`,
    `/x/invite/${"A".repeat(43)}`,
  ])("does not treat %j as a public invite link", (p) => {
    expect(decideAccess(p, null)).not.toBe("allow");
  });
});
