import { describe, expect, it } from "vitest";
import { splashPublicPaths } from "@/app/pwa";
import { decideAccess } from "@/server/auth/access";

describe("splash screens", () => {
  it("every startup image is public without a session, and only those files", () => {
    for (const p of splashPublicPaths) expect(decideAccess(p, null)).toBe("allow");
    expect(decideAccess("/splash/anything.png", null)).not.toBe("allow");
  });
});
