import { describe, expect, it } from "vitest";
import {
  BUBBLE,
  EMPTY_STATE,
  EXPRESSION_FOR_EVENT,
  FALLBACK_BUBBLE,
  FIRST_OPEN,
  GREETINGS,
  HIDDEN_TOAST,
  TAP_HINT,
  THANKS,
  bubbleFor,
  fill,
  timeOfDay,
  type HomeyEvent,
  type Vars,
} from "@/components/homey/copy";

const MAX_LENGTH = 90;
const SAMPLE_VARS: Vars = {
  name: "Sam",
  thing: "bins",
  title: "Boiler service",
  when: "on 1 Nov",
  bins: "green and black",
  n: 3,
  did: "added a task",
};

/** Every user-facing string in the module, with the placeholders filled by sample values. */
function allLines(): string[] {
  const raw = [
    ...Object.values(GREETINGS),
    ...FIRST_OPEN,
    ...Object.values(TAP_HINT),
    HIDDEN_TOAST,
    ...EMPTY_STATE,
    ...Object.values(BUBBLE).flatMap((byLight) => Object.values(byLight ?? {})),
    FALLBACK_BUBBLE,
    ...THANKS,
  ];
  return raw.map((line) => fill(line, SAMPLE_VARS));
}

function sentenceCount(line: string): number {
  return (line.match(/[.!?](\s|$)/g) ?? []).length;
}

describe("greetings", () => {
  it("has one greeting per time of day, each using {name}", () => {
    for (const slot of ["morning", "afternoon", "evening"] as const) {
      expect(GREETINGS[slot]).toContain("{name}");
    }
  });

  it.each([
    [0, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ] as const)("maps hour %i to %s", (hour, slot) => {
    expect(timeOfDay(hour)).toBe(slot);
  });
});

describe("first open", () => {
  it("opens with the exact line", () => {
    expect(FIRST_OPEN[0]).toBe("Hello, I'm your Homey, your AI assistant for this app");
  });

  it("has exactly two short follow-ups after the opener", () => {
    expect(FIRST_OPEN).toHaveLength(3);
    for (const line of FIRST_OPEN.slice(1)) {
      expect(line.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });
});

describe("tap hints and toast", () => {
  it("has the exact tap hint wording", () => {
    expect(TAP_HINT).toEqual({
      again: "Want my help? Tap me again",
      hide: "Tap 3 times to hide me",
      dontShow: "Don't show me this again",
    });
  });

  it("has the exact hidden toast", () => {
    expect(HIDDEN_TOAST).toBe("Homey's hidden. Bring him back in More > Homey");
  });
});

describe("bubbles", () => {
  it("uses the specified templates", () => {
    expect(BUBBLE.bins?.amber).toBe("Bins out tonight: {bins}");
    expect(BUBBLE.task?.red).toBe("{title} is overdue. Want to tackle it?");
    expect(BUBBLE.renewal?.amber).toBe("{title} renews {when}. Add a reminder?");
    expect(BUBBLE.figures?.amber).toBe("{n} figures still need checking");
    expect(BUBBLE.activity?.green).toBe("{name} {did}. Say thanks?");
  });

  it("fills the bins line", () => {
    expect(bubbleFor("bins", "amber", { bins: "green and black" })).toBe(
      "Bins out tonight: green and black",
    );
  });

  it("fills the figures line and uses singular wording for one figure", () => {
    expect(bubbleFor("figures", "amber", { n: 3 })).toBe("3 figures still need checking");
    expect(bubbleFor("figures", "amber", { n: 1 })).toBe("1 figure still needs checking");
  });

  it("falls back for a kind and light with no template", () => {
    expect(bubbleFor("snags", "red")).toBe(FALLBACK_BUBBLE);
  });
});

describe("thanks", () => {
  it("has six varied drafts", () => {
    expect(THANKS).toHaveLength(6);
    expect(new Set(THANKS).size).toBe(6);
  });

  it.each(THANKS.map((line, i) => [i, line] as const))("draft %i uses {name} and {thing} and ends with the purple heart", (_i, line) => {
    expect(line).toContain("{name}");
    expect(line).toContain("{thing}");
    expect(line.endsWith("💜")).toBe(true);
  });
});

describe("empty state", () => {
  it("has at least one line", () => {
    expect(EMPTY_STATE.length).toBeGreaterThan(0);
  });
});

describe("expression mapping", () => {
  it("maps events to valid expressions", () => {
    const valid = new Set(["smiley", "happy", "excited", "surprised", "concerned", "shocked", "sleepy"]);
    for (const expression of Object.values(EXPRESSION_FOR_EVENT)) {
      expect(valid.has(expression)).toBe(true);
    }
  });

  it("maps the key moments", () => {
    const expected: Partial<Record<HomeyEvent, string>> = {
      overdue: "shocked",
      due_soon: "concerned",
      all_clear: "happy",
      hidden: "sleepy",
    };
    for (const [event, expression] of Object.entries(expected)) {
      expect(EXPRESSION_FOR_EVENT[event as HomeyEvent]).toBe(expression);
    }
  });
});

describe("copy rules", () => {
  const lines = allLines();

  it("keeps every line to 90 characters or fewer once filled", () => {
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it("keeps every line to at most two sentences", () => {
    for (const line of lines) {
      expect(sentenceCount(line), line).toBeLessThanOrEqual(2);
    }
  });

  it("never mentions money, pounds or other currency", () => {
    const serialised = JSON.stringify({
      GREETINGS,
      FIRST_OPEN,
      TAP_HINT,
      HIDDEN_TOAST,
      EMPTY_STATE,
      BUBBLE,
      FALLBACK_BUBBLE,
      THANKS,
    });
    expect(serialised).not.toContain("£");
    expect(serialised).not.toMatch(/[$€]/);
    expect(serialised.toLowerCase()).not.toMatch(/\b(pounds?|money|pay|paid)\b/);
  });

  it("uses UK spelling", () => {
    const serialised = JSON.stringify({ lines }).toLowerCase();
    expect(serialised).not.toMatch(/\b(color|favorite|organize|recognize|center|analyze|customize)\b/);
  });
});

describe("fill", () => {
  it("replaces known placeholders", () => {
    expect(fill("Hello {name}, {n} left", { name: "Alex", n: 2 })).toBe("Hello Alex, 2 left");
  });

  it("drops unknown placeholders and never leaves braces behind", () => {
    expect(fill("Hi {name}, {unknown} here", { name: "Alex" })).toBe("Hi Alex, here");
    expect(fill("Hi {unknown}")).toBe("Hi");
  });

  it("drops null, undefined and object values", () => {
    expect(fill("A{x}B", { x: null })).toBe("AB");
    expect(fill("A{x}B", { x: undefined })).toBe("AB");
    expect(fill("A{x}B", { x: { nested: 1 } as unknown as string })).toBe("AB");
  });

  it("does not read inherited properties", () => {
    expect(fill("{constructor} {toString}")).toBe("");
    expect(fill("{__proto__}")).toBe("");
  });

  it("does not re-scan values, so a value with braces stays literal", () => {
    expect(fill("Say {a}", { a: "{b}", b: "oops" })).toBe("Say {b}");
  });

  it("tidies punctuation left by a dropped value", () => {
    expect(fill("Thanks, {name}.")).toBe("Thanks.");
    expect(fill("Morning, {name}!")).toBe("Morning!");
    expect(fill("Thanks {name} .")).toBe("Thanks.");
  });

  it("leaves text without placeholders unchanged", () => {
    expect(fill("Nothing to do here.")).toBe("Nothing to do here.");
    expect(fill("Hello, I'm your Homey")).toBe("Hello, I'm your Homey");
  });
});
