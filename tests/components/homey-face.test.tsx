// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeyFace } from "@/components/homey/HomeyFace";
import styles from "@/components/homey/homey.module.css";
import type { Expression } from "@/components/homey/types";

afterEach(cleanup);

const ALL: Expression[] = ["smiley", "happy", "excited", "surprised", "concerned", "shocked", "sleepy"];

function svg(container: HTMLElement) {
  const el = container.querySelector("svg");
  if (!el) throw new Error("no svg");
  return el;
}

describe("HomeyFace", () => {
  it.each(ALL)("renders the %s expression", (expression) => {
    const { container } = render(<HomeyFace expression={expression} />);
    expect(svg(container).getAttribute("data-expression")).toBe(expression);
  });

  it("defaults to 56px and honours size", () => {
    const { container, rerender } = render(<HomeyFace expression="smiley" />);
    expect(svg(container).getAttribute("width")).toBe("56");
    rerender(<HomeyFace expression="smiley" size={24} />);
    expect(svg(container).getAttribute("height")).toBe("24");
  });

  it("is decorative without a title", () => {
    const { container } = render(<HomeyFace expression="smiley" />);
    const el = svg(container);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is a labelled image with a title", () => {
    render(<HomeyFace expression="shocked" title="Homey: something is overdue" />);
    const img = screen.getByRole("img", { name: "Homey: something is overdue" });
    expect(img.getAttribute("aria-hidden")).toBeNull();
    expect(img.querySelector("title")?.textContent).toBe("Homey: something is overdue");
  });

  it("animated=false adds the static class", () => {
    const { container, rerender } = render(<HomeyFace expression="happy" />);
    expect(svg(container).classList.contains(styles.static)).toBe(false);
    rerender(<HomeyFace expression="happy" animated={false} />);
    expect(svg(container).classList.contains(styles.static)).toBe(true);
    expect(svg(container).getAttribute("data-animated")).toBe("false");
  });

  it("pops on expression change, alternating so the animation restarts", () => {
    const { container, rerender } = render(<HomeyFace expression="smiley" />);
    const el = svg(container);
    expect(el.classList.contains(styles.popA) || el.classList.contains(styles.popB)).toBe(false);
    rerender(<HomeyFace expression="excited" />);
    expect(el.classList.contains(styles.popA)).toBe(true);
    rerender(<HomeyFace expression="shocked" />);
    expect(el.classList.contains(styles.popB)).toBe(true);
    expect(el.getAttribute("data-expression")).toBe("shocked");
  });

  it("sets glance and per-instance blink timing", () => {
    const { container } = render(<HomeyFace expression="smiley" glance="left" />);
    const el = svg(container);
    expect(el.getAttribute("data-glance")).toBe("left");
    const period = parseFloat(el.style.getPropertyValue("--homey-blink"));
    expect(period).toBeGreaterThanOrEqual(3);
    expect(period).toBeLessThanOrEqual(6);
    const tilt = parseFloat(el.style.getPropertyValue("--homey-tilt"));
    expect(tilt).toBeGreaterThanOrEqual(8);
    expect(tilt).toBeLessThanOrEqual(13);
  });

  it("marks talking and greeting only when asked", () => {
    const { container, rerender } = render(<HomeyFace expression="smiley" />);
    expect(svg(container).hasAttribute("data-talking")).toBe(false);
    expect(svg(container).hasAttribute("data-greet")).toBe(false);
    rerender(<HomeyFace expression="smiley" talking greet />);
    expect(svg(container).getAttribute("data-talking")).toBe("true");
    expect(svg(container).getAttribute("data-greet")).toBe("true");
  });

  it("draws every mouth as a line, with no dark filled shape under the eyes", () => {
    const { container } = render(<HomeyFace expression="happy" />);
    const mouth = container.querySelector(`.${styles.mouth}`);
    expect(mouth).not.toBeNull();
    for (const el of mouth!.querySelectorAll("path, ellipse, circle")) {
      const fill = el.getAttribute("fill") ?? el.closest("[fill]")?.getAttribute("fill") ?? "";
      expect(fill === "none" || fill.startsWith("rgba(255,255,255")).toBe(true);
    }
  });

  it("uses unique gradient ids per instance", () => {
    const { container } = render(
      <>
        <HomeyFace expression="smiley" />
        <HomeyFace expression="happy" />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps the markup under 4 KB", () => {
    const html = renderToStaticMarkup(<HomeyFace expression="excited" title="Homey" />);
    expect(html.length).toBeLessThan(4096);
  });
});

describe("HomeyFace reduced motion", () => {
  const css = readFileSync(path.resolve(__dirname, "../../src/components/homey/homey.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("switches off every animation and transition on the face", () => {
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced).toMatch(/\.root,\s*\.root \*\s*\{[^}]*animation:\s*none !important;[^}]*transition:\s*none !important;/);
  });

  it("only animates things inside the face, so the reduced-motion rule covers them all", () => {
    const outside = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation:/g)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.startsWith("@"))
      .flatMap((sel) => sel.split(",").map((x) => x.trim()))
      .filter((sel) => sel && !/^\.(root|bob|tilt|wave|blink|popA|popB|spark|static)\b/.test(sel));
    expect(outside).toEqual([]);
  });

  it("animated=false switches the same animations off without the media query", () => {
    expect(css).toMatch(/\.static \*,\s*\.static\s*\{[^}]*animation:\s*none !important;/);
  });
});
