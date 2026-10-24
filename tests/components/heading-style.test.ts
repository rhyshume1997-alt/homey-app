import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Blocks that declare --background: split the file at each such declaration's enclosing rule.
const blocks: string[] = [];
for (const m of css.matchAll(/(:root[^{]*)\{([^{}]*)\}/g)) {
  if (/--background\s*:/.test(m[2])) blocks.push(m[2]);
}
const token = (block: string, name: string) => block.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))?.[1];

describe("heading style", () => {
  it("finds the three theme blocks", () => {
    expect(blocks.length).toBe(3);
  });

  it("defines --heading in every theme block with --background", () => {
    for (const b of blocks) expect(token(b, "heading")).toBeTruthy();
  });

  it("meets WCAG AA against background and surfaces in every theme", () => {
    for (const b of blocks) {
      const h = token(b, "heading")!;
      for (const t of ["background", "surface", "surface-muted"]) {
        expect(contrast(h, token(b, t)!), `${t} in ${b.slice(0, 30)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("styles #main h1/h2/h3 with an unlayered rule", () => {
    expect(css).toMatch(/#main\s+:is\(h1,\s*h2,\s*h3\)[^{]*\{[^}]*color:\s*var\(--heading\)/);
    expect(css).toMatch(/#main\s+h1[^{]*\{[^}]*1\.75rem/);
    expect(css).toMatch(/#main\s+h2[^{]*\{[^}]*1\.25rem/);
    expect(css).toMatch(/#main\s+h3[^{]*\{[^}]*1\.0625rem/);
    const idx = css.indexOf("#main :is(h1");
    expect(idx).toBeGreaterThan(-1);
    let depth = 0;
    for (const ch of css.slice(0, idx)) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth).toBe(0);
    expect(css.slice(0, idx)).not.toMatch(/@layer\s+[\w-]+\s*\{/);
  });
});
