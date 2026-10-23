// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WishlistView } from "@/components/wishlist/WishlistView";
import { RoomWishlist } from "@/components/wishlist/RoomWishlist";
import { ShopLink } from "@/components/wishlist/ShopLink";
import type { WishlistActions } from "@/components/wishlist/types";
import { WishlistInputSchema, parseShopUrl, type WishlistItem } from "@/contracts/wishlist";

afterEach(cleanup);

const noop = async () => null;
const actions: WishlistActions = { add: noop, update: noop, setStatus: noop, remove: noop };
const R1 = "00000000-0000-4000-8000-0000000000a1";
const R2 = "00000000-0000-4000-8000-0000000000a2";
const rooms = [{ id: R1, name: "Living room" }, { id: R2, name: "Kitchen" }];

let n = 0;
const item = (o: Partial<WishlistItem> = {}): WishlistItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  room_id: null, title: "Lamp", price_estimate: null, url: null, priority: "medium", status: "idea",
  photo_document_id: null, notes: null, bought_at: null, ...o,
});

describe("parseShopUrl", () => {
  it("accepts https and rejects everything else", () => {
    expect(parseShopUrl("https://shop.example.test/a?b=1")).toBe("https://shop.example.test/a?b=1");
    for (const bad of [
      "http://shop.example.test", "javascript:alert(1)", "data:text/html,x", "blob:https://x.test/1", "file:///etc/passwd",
      "https://u:p@shop.example.test/", "https://user@shop.example.test/", "//shop.example.test", "not a url", "",
      `https://shop.example.test/${"a".repeat(2048)}`, "https://shop.example.test/a b",
    ]) {
      expect(parseShopUrl(bad), bad).toBeNull();
    }
  });
  it("form schema fails on a bad link and treats empty as none", () => {
    const ok = { title: "x", room_id: "", price_estimate: "£1,250.5", url: "", priority: "high", notes: "" };
    expect(WishlistInputSchema.parse(ok)).toMatchObject({ room_id: null, price_estimate: 1250.5, url: null, notes: null });
    expect(WishlistInputSchema.safeParse({ ...ok, url: "javascript:alert(1)" }).success).toBe(false);
    expect(WishlistInputSchema.safeParse({ ...ok, price_estimate: "abc" }).success).toBe(false);
    expect(WishlistInputSchema.safeParse({ ...ok, title: " " }).success).toBe(false);
  });
});

describe("ShopLink", () => {
  it("renders a safe external link", () => {
    render(<ShopLink url="https://www.shop.example.test/lamp" />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe("https://www.shop.example.test/lamp");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("renders nothing for an unsafe stored value", () => {
    render(<ShopLink url="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("WishlistView", () => {
  it("groups by room, labels the price as rough, and shows the never-buys line and #new anchor", () => {
    const { container } = render(
      <WishlistView
        rooms={rooms}
        actions={actions}
        items={[
          item({ title: "Lamp", room_id: R1, price_estimate: 49.99, url: "https://shop.example.test/lamp" }),
          item({ title: "Kettle", room_id: R2 }),
          item({ title: "Spare plant" }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Living room" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kitchen" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No room" })).toBeTruthy();
    expect(screen.getByText("Rough price £49.99")).toBeTruthy();
    expect(screen.getByText("Links open the shop. Nothing is ever bought automatically.")).toBeTruthy();
    expect(container.querySelector("#new")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in shop.example.test/ }).getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("filters by status and marks the active chip", () => {
    const items = [item({ title: "Idea one" }), item({ title: "Saving one", status: "saving" }), item({ title: "Bought one", status: "bought" })];
    render(<WishlistView rooms={rooms} actions={actions} items={items} filter="saving" />);
    expect(screen.getByRole("heading", { name: "Saving one" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Idea one" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Filter by status" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["All", "Idea", "Saving for", "Bought"]);
    expect(within(nav).getByRole("link", { name: "Saving for" }).getAttribute("aria-current")).toBe("page");
  });

  it("offers status moves, edit and delete for each item", () => {
    render(<WishlistView rooms={rooms} actions={actions} items={[item({ title: "Rug", status: "idea" })]} />);
    expect(screen.getByRole("button", { name: "Move to Saving for: Rug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark bought: Rug" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to Idea: Rug" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete: Rug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("shows an empty state", () => {
    render(<WishlistView rooms={rooms} actions={actions} items={[]} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to Things to get" })).toBeTruthy();
  });
});

describe("RoomWishlist", () => {
  it("lists items with status and rough price, and links to add", () => {
    render(<RoomWishlist items={[item({ title: "Curtains", status: "saving", price_estimate: 80, url: "https://shop.example.test/c" })]} />);
    expect(screen.getByText("Curtains")).toBeTruthy();
    expect(screen.getByText("Saving for · Rough price £80")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add something to get" }).getAttribute("href")).toBe("/things-to-get#new");
  });
  it("shows an empty state", () => {
    render(<RoomWishlist items={[]} />);
    expect(screen.getByText("Nothing to get for this room.")).toBeTruthy();
  });
});
