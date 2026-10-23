import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  exchange: vi.fn(),
  setSession: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/server/db/supabase", () => ({
  createUserClient: async () => ({
    auth: { exchangeCodeForSession: m.exchange, setSession: m.setSession, signOut: m.signOut },
    rpc: m.rpc,
  }),
}));
vi.mock("@/server/auth/session", () => ({ getSession: m.getSession }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }) }));
vi.mock("@/server/integrations/google/token", () => ({
  googleEnv: () => ({ clientId: "id", clientSecret: "secret" }),
  refreshAccessToken: m.refresh,
  clearAccessTokenCache: () => {},
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/google/callback/route";

const U = { userId: "11111111-1111-4111-8111-111111111111", householdId: "h", role: "owner", displayName: "Alex" };
const req = (q: string) => new NextRequest(`https://house.example/auth/google/callback${q}`);
const SESSION = { access_token: "at", refresh_token: "rt", provider_token: "pt", provider_refresh_token: "prt-secret" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getSession.mockResolvedValue(U);
  m.setSession.mockResolvedValue({ data: {}, error: null });
  m.refresh.mockResolvedValue({ ok: true, scope: "https://www.googleapis.com/auth/spreadsheets.readonly" });
  m.rpc.mockResolvedValue({ error: null });
});

describe("Google connect callback (review S1/S3)", () => {
  it("rewrites the session without provider tokens before storing the encrypted token", async () => {
    m.exchange.mockResolvedValue({ data: { session: SESSION }, error: null });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toContain("/settings/google?connected=1");
    expect(m.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
    expect(JSON.stringify(m.setSession.mock.calls)).not.toContain("prt-secret");
    expect(m.rpc).toHaveBeenCalledWith("store_my_google_token", expect.objectContaining({ p_scopes: expect.any(String) }));
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain("prt-secret");
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it("a forged or failed code does not sign the user out anywhere", async () => {
    m.exchange.mockResolvedValue({ data: { session: null }, error: { message: "bad" } });
    const res = await GET(req("?code=forged"));
    expect(res.headers.get("location")).toContain("/settings/google?error=failed");
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it("a different Google account ends only this browser's session", async () => {
    m.exchange.mockResolvedValue({ data: { session: SESSION }, error: null });
    m.getSession.mockResolvedValueOnce(U).mockResolvedValueOnce({ ...U, userId: "22222222-2222-4222-8222-222222222222" });
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toContain("/login?error=denied");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
