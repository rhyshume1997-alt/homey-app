import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_MSG } from "@/contracts/recipe-import";
import { RATE, allowFetch, previewFromText, previewFromUrl, resetRateLimit, sourceOf } from "./import";
import type { Lookup, RawResponse, Transport } from "./ssrf";

const fixture = (f: string) => readFileSync(path.join(__dirname, "__fixtures__", f), "utf8");
const lookup: Lookup = async () => [{ address: "93.184.215.14", family: 4 }];
async function* body(s: string) {
  yield Buffer.from(s);
}
const res = (status: number, ct: string | null, text = "", extra: Record<string, string> = {}): RawResponse => ({
  status,
  headers: { ...(ct ? { "content-type": ct } : {}), ...extra },
  body: body(text),
  destroy: () => {},
});

beforeEach(() => resetRateLimit());

describe("sourceOf", () => {
  it.each([
    ["https://www.tiktok.com/@cook/video/1", "tiktok"],
    ["https://tiktok.com/@cook/video/1", "tiktok"],
    ["https://vm.tiktok.com/ZMabc/", "tiktok"],
    ["https://tiktok.com.evil.example/x", "website"],
    ["https://eviltiktok.com/x", "website"],
    ["https://www.instagram.com/reel/abc/", "instagram"],
    ["https://instagr.am/p/abc/", "instagram"],
    ["https://recipes.example/pasta", "website"],
  ])("%s -> %s", (u, s) => expect(sourceOf(new URL(u))).toBe(s));
});

describe("previewFromUrl: website", () => {
  it("returns a preview from JSON-LD and saves nothing", async () => {
    const transport = vi.fn<Transport>(async () => res(200, "text/html", fixture("jsonld-graph.html")));
    const r = await previewFromUrl("https://recipes.example/pasta", "u1", { lookup, transport });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.source).toBe("website");
    expect(r.preview.title).toBe("Weeknight Tomato Pasta & Basil");
    expect(r.preview.ingredients[0]).toEqual({ name: "chopped tomatoes", quantity: "2 tins" });
  });

  it("says when no recipe is found", async () => {
    const transport: Transport = async () => res(200, "text/html", fixture("no-recipe.html"));
    expect(await previewFromUrl("https://recipes.example/about", "u1", { lookup, transport })).toEqual({
      ok: false,
      error: IMPORT_MSG.noRecipe,
      source: "website",
    });
  });

  it("maps guard blocks and fetch failures to fixed messages", async () => {
    const transport = vi.fn<Transport>();
    expect(await previewFromUrl("http://recipes.example/", "u1", { lookup, transport })).toMatchObject({ error: IMPORT_MSG.invalidUrl });
    expect(await previewFromUrl("not a link", "u1", { lookup, transport })).toMatchObject({ error: IMPORT_MSG.invalidUrl });
    expect(await previewFromUrl("https://10.0.0.1/", "u1", { lookup, transport })).toMatchObject({ error: IMPORT_MSG.blocked });
    expect(await previewFromUrl("https://localhost/", "u1", { lookup, transport })).toMatchObject({ error: IMPORT_MSG.blocked });
    const privateDns: Lookup = async () => [{ address: "192.168.1.1", family: 4 }];
    expect(await previewFromUrl("https://nas.example/", "u1", { lookup: privateDns, transport })).toMatchObject({ error: IMPORT_MSG.blocked });
    expect(transport).not.toHaveBeenCalled();
    const notFound: Transport = async () => res(404, "text/html");
    expect(await previewFromUrl("https://recipes.example/gone", "u1", { lookup, transport: notFound })).toMatchObject({
      error: IMPORT_MSG.fetchFailed,
    });
  });

  it("never puts the URL or page content into the error", async () => {
    const transport: Transport = async () => res(200, "image/png", "SECRET");
    const r = await previewFromUrl("https://recipes.example/x?token=abc", "u1", { lookup, transport });
    expect(JSON.stringify(r)).not.toMatch(/token|abc|SECRET|recipes\.example/);
  });
});

describe("previewFromUrl: TikTok", () => {
  const caption = "Creamy pretend pasta 🍝\nIngredients:\n- 200g pasta\n- 100ml cream\n- a pinch of salt\nMethod: boil it #pasta";

  it("reads the oEmbed caption from www.tiktok.com only", async () => {
    const transport = vi.fn<Transport>(async () => res(200, "application/json", JSON.stringify({ title: caption, author_name: "x" })));
    const link = "https://www.tiktok.com/@cook/video/7300000000000000000?is_from_webapp=1";
    const r = await previewFromUrl(link, "u1", { lookup, transport });
    expect(transport).toHaveBeenCalledTimes(1);
    const called = transport.mock.calls[0][0];
    expect(called.origin + called.pathname).toBe("https://www.tiktok.com/oembed");
    expect(called.searchParams.get("url")).toBe(link);
    expect(r).toEqual({
      ok: true,
      preview: {
        title: "Creamy pretend pasta 🍝",
        source: "tiktok",
        ingredients: [
          { name: "pasta", quantity: "200g" },
          { name: "cream", quantity: "100ml" },
          { name: "salt", quantity: "a pinch" },
        ],
      },
    });
  });

  it("says so when the caption has no ingredients", async () => {
    const transport: Transport = async () => res(200, "application/json", JSON.stringify({ title: "Recipe in bio! #food" }));
    expect(await previewFromUrl("https://www.tiktok.com/@a/video/1", "u1", { lookup, transport })).toEqual({
      ok: false,
      error: IMPORT_MSG.tiktokNone,
      source: "tiktok",
    });
  });

  it("offers the paste box when oEmbed fails", async () => {
    const transport: Transport = async () => res(400, "application/json", "{}");
    expect(await previewFromUrl("https://www.tiktok.com/@a/video/1", "u1", { lookup, transport })).toMatchObject({
      ok: false,
      error: IMPORT_MSG.tiktokFailed,
    });
  });

  it("expands a vm.tiktok.com short link under the guard, then asks oEmbed for the full link", async () => {
    const seen: string[] = [];
    const transport: Transport = async (u) => {
      seen.push(u.toString());
      if (u.pathname === "/oembed") {
        return u.searchParams.get("url")!.startsWith("https://vm.")
          ? res(400, "application/json", "{}")
          : res(200, "application/json", JSON.stringify({ title: caption }));
      }
      if (u.hostname === "vm.tiktok.com") return res(301, null, "", { location: "https://www.tiktok.com/@cook/video/1" });
      return res(200, "text/html", "<html></html>");
    };
    const r = await previewFromUrl("https://vm.tiktok.com/ZMabc/", "u1", { lookup, transport });
    expect(r.ok).toBe(true);
    expect(seen.map((s) => new URL(s).hostname)).toEqual(["www.tiktok.com", "vm.tiktok.com", "www.tiktok.com", "www.tiktok.com"]);
  });
});

describe("previewFromUrl: Instagram", () => {
  it("does not fetch and explains why, offering the paste box", async () => {
    const transport = vi.fn<Transport>();
    const r = await previewFromUrl("https://www.instagram.com/reel/Cxyz/", "u1", { lookup, transport });
    expect(r).toEqual({ ok: false, error: IMPORT_MSG.instagram, source: "instagram" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("rate limit", () => {
  it(`allows ${RATE.limit} per 10 minutes per user`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE.limit; i++) expect(allowFetch("a", t0 + i)).toBe(true);
    expect(allowFetch("a", t0 + 100)).toBe(false);
    expect(allowFetch("b", t0 + 100)).toBe(true); // per user
    expect(allowFetch("a", t0 + RATE.windowMs + 10)).toBe(true); // window slides
  });

  it("the 11th link fetch returns the rate message without fetching", async () => {
    const transport = vi.fn<Transport>(async () => res(200, "text/html", fixture("jsonld-graph.html")));
    for (let i = 0; i < RATE.limit; i++) await previewFromUrl("https://recipes.example/p", "u9", { lookup, transport });
    const before = transport.mock.calls.length;
    expect(await previewFromUrl("https://recipes.example/p", "u9", { lookup, transport })).toMatchObject({ error: IMPORT_MSG.rate });
    expect(transport.mock.calls.length).toBe(before);
  });
});

describe("previewFromText", () => {
  it("uses the same extractor with source text", () => {
    const r = previewFromText("Ingredients:\n2 tins chopped tomatoes\n200g pasta");
    expect(r).toEqual({
      ok: true,
      preview: {
        title: "",
        source: "text",
        ingredients: [
          { name: "chopped tomatoes", quantity: "2 tins" },
          { name: "pasta", quantity: "200g" },
        ],
      },
    });
  });
  it("rejects empty and ingredient-free text", () => {
    expect(previewFromText("  ")).toMatchObject({ error: IMPORT_MSG.textEmpty });
    expect(previewFromText(42)).toMatchObject({ error: IMPORT_MSG.textEmpty });
    expect(previewFromText("We loved this one, recipe in bio.")).toMatchObject({ error: IMPORT_MSG.textNone });
  });
});
