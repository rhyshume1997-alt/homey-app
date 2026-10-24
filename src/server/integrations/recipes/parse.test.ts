import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanText, extractIngredientLines, pageTitle, parseIngredientLine, recipeFromHtml, recipeFromJsonLd, recipeFromMicrodata,
  titleFromText, toIngredients,
} from "./parse";

const fixture = (f: string) => readFileSync(path.join(__dirname, "__fixtures__", f), "utf8");

describe("parseIngredientLine", () => {
  it.each([
    ["2 tins chopped tomatoes", "2 tins", "chopped tomatoes"],
    ["200g pasta", "200g", "pasta"],
    ["200 g pasta", "200 g", "pasta"],
    ["1½ tbsp oil", "1½ tbsp", "oil"],
    ["1 ½ tbsp oil", "1 ½ tbsp", "oil"],
    ["½ tsp chilli flakes", "½ tsp", "chilli flakes"],
    ["1 1/2 cups of flour", "1 1/2 cups", "flour"],
    ["3/4 cup milk", "3/4 cup", "milk"],
    ["a pinch of salt", "a pinch", "salt"],
    ["A handful of spinach", "A handful", "spinach"],
    ["half a tin of coconut milk", "half a tin", "coconut milk"],
    ["2 x 400g tins chickpeas", "2 x 400g tins", "chickpeas"],
    ["1 (400g) tin black beans", "1 (400g) tin", "black beans"],
    ["3-4 cloves garlic", "3-4 cloves", "garlic"],
    ["1.5kg chicken thighs", "1.5kg", "chicken thighs"],
    ["2 large eggs", "2", "large eggs"],
    ["1 lemon", "1", "lemon"],
    ["2 garlic cloves", "2", "garlic cloves"],
    ["Pasta 200g", "200g", "Pasta"],
    ["Chicken thighs x4", "x4", "Chicken thighs"],
    ["Tomatoes - 2 tins", "2 tins", "Tomatoes"],
    ["Salt, to taste", "to taste", "Salt"],
    ["- 100ml double cream", "100ml", "double cream"],
    ["• 1 onion, finely chopped", "1", "onion, finely chopped"],
    ["🍅 2 tins tomatoes", "2 tins", "tomatoes"],
    ["1. 200g rice", "200g", "rice"],
    ["Salt and pepper", null, "Salt and pepper"],
    ["Parmesan &amp; basil", null, "Parmesan & basil"],
    ["250g halloumi #fakefood #dinner", "250g", "halloumi"],
  ])("%s", (line, quantity, name) => {
    expect(parseIngredientLine(line)).toEqual({ quantity, name });
  });

  it("returns null for empty or quantity-only lines", () => {
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine("• ")).toBeNull();
    expect(parseIngredientLine("#recipe #food")).toBeNull();
    expect(parseIngredientLine("200")).toBeNull();
  });

  it("keeps names and quantities within the meal limits", () => {
    const r = parseIngredientLine(`2 tbsp ${"very ".repeat(30)}long name`)!;
    expect(r.name.length).toBeLessThanOrEqual(60);
    expect(r.quantity).toBe("2 tbsp");
  });
});

describe("toIngredients", () => {
  it("dedupes by name and caps at 30", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `${i + 1}g item ${i}`);
    const { ingredients, truncated } = toIngredients(["1 onion", "2 Onion", ...lines]);
    expect(ingredients).toHaveLength(30);
    expect(ingredients.filter((i) => i.name.toLowerCase() === "onion")).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});

describe("schema.org Recipe from HTML", () => {
  it("finds a Recipe inside @graph with a @type array, decoding entities and tags", () => {
    const r = recipeFromHtml(fixture("jsonld-graph.html"))!;
    expect(r.title).toBe("Weeknight Tomato Pasta & Basil");
    expect(r.ingredients).toEqual([
      { quantity: "2 tins", name: "chopped tomatoes" },
      { quantity: "200g", name: "pasta" },
      { quantity: "1½ tbsp", name: "olive oil" },
      { quantity: "3 cloves", name: "garlic, crushed" },
      { quantity: "a pinch", name: "salt" },
      { quantity: "to serve", name: "Fresh basil" },
    ]);
    expect(r.truncated).toBe(false);
  });

  it("handles a top-level array, a full schema URL type, a newline string and HTML comments", () => {
    const r = recipeFromHtml(fixture("jsonld-array.html"))!;
    expect(r.title).toBe("Pretend Chickpea Curry");
    expect(r.ingredients.map((i) => i.name)).toEqual(["onion", "chickpeas", "curry powder"]);
    expect(r.ingredients[1].quantity).toBe("400g tin");
  });

  it("skips a malformed JSON-LD block and uses the next", () => {
    expect(recipeFromJsonLd(fixture("broken-then-valid.html"))?.lines).toEqual(["250g oats", "125g butter", "4 tbsp golden syrup"]);
  });

  it("falls back to microdata itemprop=recipeIngredient, including meta content", () => {
    expect(recipeFromJsonLd(fixture("microdata.html"))).toBeNull();
    const m = recipeFromMicrodata(fixture("microdata.html"))!;
    expect(m.lines).toEqual(["100g plain flour", "2 large eggs", "300ml milk", "1 tbsp sunflower oil"]);
    const r = recipeFromHtml(fixture("microdata.html"))!;
    expect(r.title).toBe("Imaginary Pancakes");
    expect(r.ingredients[1]).toEqual({ quantity: "2", name: "large eggs" });
  });

  it("returns null when the page has no recipe", () => {
    expect(recipeFromHtml(fixture("no-recipe.html"))).toBeNull();
    expect(recipeFromHtml("")).toBeNull();
  });

  it("reads og:title, then <title>", () => {
    expect(pageTitle(fixture("jsonld-graph.html"))).toBe("Weeknight Tomato Pasta");
    expect(pageTitle("<title>Only &amp; title</title>")).toBe("Only & title");
  });

  it("survives deeply nested or huge JSON without hanging", () => {
    let deep: unknown = { "@type": "Recipe", name: "Deep", recipeIngredient: ["1 egg"] };
    for (let i = 0; i < 50; i++) deep = { child: deep };
    const html = `<script type="application/ld+json">${JSON.stringify(deep)}</script>`;
    expect(recipeFromJsonLd(html)).toBeNull(); // beyond the depth limit: ignored, not crashed
  });
});

describe("extractIngredientLines (captions and pasted text)", () => {
  const caption = `Easiest one-pan gnocchi you'll ever make 🍝 #dinner #madeup

Ingredients:
- 500g gnocchi
- 1 tin chopped tomatoes
• 2 balls mozzarella
For the topping:
- a handful of basil

Method:
1. Fry the gnocchi until golden.
2. Add the tomatoes and simmer for 10 mins.
#easyrecipes #fakefood`;

  it("takes the block after Ingredients and stops at Method", () => {
    expect(extractIngredientLines(caption)).toEqual(["500g gnocchi", "1 tin chopped tomatoes", "2 balls mozzarella", "a handful of basil"]);
    expect(titleFromText(caption)).toBe("Easiest one-pan gnocchi you'll ever make 🍝");
  });

  it("splits an inline comma list after Ingredients:", () => {
    expect(extractIngredientLines("Ingredients: pasta, 2 tins tomatoes; basil\nEnjoy!")).toEqual(["pasta", "2 tins tomatoes", "basil"]);
  });

  it("stops the section at a blank line followed by prose", () => {
    const t = "INGREDIENTS\n200g rice\n1 onion\n\nCook everything together in a big pan until soft and lovely.";
    expect(extractIngredientLines(t)).toEqual(["200g rice", "1 onion"]);
  });

  it("without a heading, uses bullet and quantity lines and skips numbered steps", () => {
    const t = "Quick soup!\n✅ 1 leek\n✅ 2 potatoes\n300ml stock\n1. Chop everything\n2. Simmer 20 mins\nSo good #soup";
    expect(extractIngredientLines(t)).toEqual(["1 leek", "2 potatoes", "300ml stock"]);
  });

  it("finds nothing in a caption without ingredients", () => {
    const t = "Date night dinner ❤️ recipe in bio! #food #foodie";
    expect(extractIngredientLines(t)).toEqual([]);
  });

  it("titleFromText gives up on ingredient-first text", () => {
    expect(titleFromText("Ingredients:\n1 egg")).toBe("");
    expect(titleFromText("- 1 egg")).toBe("");
  });

  it("cleanText strips tags and collapses whitespace", () => {
    expect(cleanText("<b>2</b>&nbsp; eggs &#189;")).toBe("2 eggs ½");
  });
});

describe("hostile pages stay fast (regex parsing is bounded)", () => {
  const bombs: [string, string][] = [
    ["unclosed tags", "<a ".repeat(700_000)],
    ["unclosed itemprop tags", '<span itemprop="recipeIngredient" '.repeat(60_000)],
    ["unclosed ld+json scripts", '<script type="application/ld+json">'.repeat(60_000)],
    ["unclosed meta", "<meta ".repeat(300_000)],
    ["unclosed title", "<title>".repeat(250_000)],
  ];
  for (const [name, html] of bombs) {
    it(`${name} (${Math.round(html.length / 1000)} KB) parses in under 1 s`, () => {
      const t = performance.now();
      recipeFromHtml(html);
      expect(performance.now() - t).toBeLessThan(1000);
    });
  }
});

describe("cleanText stays linear", () => {
  it("2 MB of '<' parses in under 1 s", () => {
    const t = performance.now();
    cleanText("<".repeat(2_000_000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
