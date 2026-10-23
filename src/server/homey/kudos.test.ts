import { describe, expect, it } from "vitest";
import { THANKS } from "@/components/homey/copy";
import { KUDOS_MAX, KudosMessageSchema, parseKudosKey } from "@/contracts/kudos";
import { draftThanks } from "./kudos";

describe("draftThanks", () => {
  it("fills name and thing with no placeholders left", () => {
    for (let i = 0; i < THANKS.length; i++) {
      const d = draftThanks({ auditId: i, name: "Sam", thing: "Hoover stairs" });
      expect(d).toContain("Sam");
      expect(d).toContain("hoover stairs");
      expect(d).not.toMatch(/[{}]/);
    }
  });
  it("is deterministic and within the cap", () => {
    const a = draftThanks({ auditId: 7, name: "R", thing: "x".repeat(500) });
    expect(a).toBe(draftThanks({ auditId: 7, name: "R", thing: "x".repeat(500) }));
    expect(a.length).toBeLessThanOrEqual(KUDOS_MAX);
  });
});

describe("kudos contract", () => {
  it("parses keys strictly", () => {
    expect(parseKudosKey("kudos:12")).toBe(12);
    for (const k of ["kudos:0", "kudos:-1", "kudos:1.5", "kudos:1;drop", "task:1", "kudos:", 5, null]) {
      expect(parseKudosKey(k)).toBeNull();
    }
  });
  it("validates the message", () => {
    expect(KudosMessageSchema.safeParse("  Thanks 💜 ").data).toBe("Thanks 💜");
    expect(KudosMessageSchema.safeParse("   ").success).toBe(false);
    expect(KudosMessageSchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(KudosMessageSchema.safeParse("a".repeat(200)).success).toBe(true);
    expect(KudosMessageSchema.safeParse("hi\u0000there").success).toBe(false);
  });
});
