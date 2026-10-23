import { describe, expect, it } from "vitest";
import { parseBoschEmail } from "./bosch";
import { parseEonEmail } from "./eon";
import { addYears, bodyTexts, htmlToText, normaliseText, parseDate, safeText } from "./text";

// All fixtures are synthetic. No real emails.
const RECEIVED = "2024-11-15T10:00:00.000Z";

describe("text helpers", () => {
  it("parses UK dates only, rejecting impossible ones", () => {
    expect(parseDate("14/11/2024")).toBe("2024-11-14");
    expect(parseDate("14.11.24")).toBe("2024-11-14");
    expect(parseDate("2024-11-14")).toBe("2024-11-14");
    expect(parseDate("14th November 2024")).toBe("2024-11-14");
    expect(parseDate("Thursday, 14 Nov 2024")).toBe("2024-11-14");
    expect(parseDate("November 14, 2024")).toBe("2024-11-14");
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("11/31/2024")).toBeNull(); // US order is not guessed
    expect(parseDate("14/11/1899")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
  it("adds years, mapping 29 Feb to 28 Feb", () => {
    expect(addYears("2024-11-14", 2)).toBe("2026-11-14");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });
  it("strips HTML, scripts, comments and links linearly", () => {
    const t = normaliseText(htmlToText(
      '<html><head><title>x</title><style>p{}</style></head><body><!-- c --><p>Model:&nbsp;<b>WGG254Z0GB</b></p>' +
      '<script>alert("SMS9ZZZ99Z")</script><table><tr><td>Order date</td><td>14/11/2024</td></tr></table>' +
      '<a href="https://evil.example/x">https://evil.example/x click</a></body></html>',
    ));
    expect(t).toContain("Model: WGG254Z0GB");
    expect(t).toContain("Order date | 14/11/2024");
    expect(t).not.toContain("alert");
    expect(t).not.toContain("evil.example");
    expect(t).not.toContain("<");
    // Pathological input finishes quickly.
    const start = Date.now();
    htmlToText("<script".repeat(50_000));
    htmlToText("<a ".repeat(50_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
  it("safeText removes tags, links, addresses and caps length", () => {
    expect(safeText('<img src=x onerror=alert(1)>Series 6 <a href="https://x.y">dishwasher</a> mail me@x.com', 80)).toBe("Series 6 dishwasher mail");
    expect(Array.from(safeText("é".repeat(500), 80)!)).toHaveLength(80);
    expect(safeText("   ", 10)).toBeNull();
  });
  it("decodes plain and HTML parts and skips attachments", () => {
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    const r = bodyTexts({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/alternative", parts: [
          { mimeType: "text/plain", body: { data: b64("Hello\r\nModel: SMS6ZCI49E") } },
          { mimeType: "text/html", body: { data: b64("<p>Hi</p>") } },
        ] },
        { mimeType: "text/plain", filename: "invoice.txt", body: { attachmentId: "a1" } },
      ],
    });
    expect(r.plain).toBe("Hello\nModel: SMS6ZCI49E");
    expect(r.html).toBe("Hi");
  });
});

const ORDER = `Thank you for your order
Order number: 100200300
Order date: 14/11/2024
Product: Bosch Series 6 dishwasher, 60 cm
E-Nr.: SMS6ZCI49E/01
Quantity 1
Your appliance comes with a 2 year guarantee.
View your order at https://example.invalid/track`;

describe("parseBoschEmail", () => {
  it("order confirmation: model, product, purchase date and computed warranty", () => {
    const p = parseBoschEmail({ subject: "Your order confirmation", text: ORDER, receivedAt: RECEIVED })!;
    expect(p.kind).toBe("order");
    expect(p.fields).toEqual({
      make: "Bosch",
      model: "SMS6ZCI49E/01",
      productName: "Bosch Series 6 dishwasher, 60 cm",
      purchaseDate: "2024-11-14",
      warrantyEnd: "2026-11-14",
      warrantyComputed: true,
      warrantyYears: 2,
    });
    expect(p.found).toEqual({ model: true, productName: true, purchaseDate: true, warrantyEnd: false, warrantyYears: true });
  });

  it("registration with explicit warranty end: not computed", () => {
    const p = parseBoschEmail({
      subject: "Your appliance registration",
      text: "Thanks for registering.\nModel number: WGG254Z0GB\nPurchase date: 3 March 2024\nWarranty end date: 2 March 2029",
      receivedAt: RECEIVED,
    })!;
    expect(p.kind).toBe("registration");
    expect(p.fields.model).toBe("WGG254Z0GB");
    expect(p.fields.purchaseDate).toBe("2024-03-03");
    expect(p.fields.warrantyEnd).toBe("2029-03-02");
    expect(p.fields.warrantyComputed).toBe(false);
    expect(p.found.warrantyEnd).toBe(true);
    expect(p.fields.productName).toBeNull();
  });

  it("finds an unlabelled model code with a known prefix", () => {
    const p = parseBoschEmail({ subject: "Warranty", text: "Your WAN28282GB washing machine is covered by our guarantee.", receivedAt: RECEIVED })!;
    expect(p.fields.model).toBe("WAN28282GB");
    expect(p.fields.purchaseDate).toBeNull();
    expect(p.fields.warrantyEnd).toBeNull();
  });

  it("never guesses: several models -> null with options; conflicting years -> no warranty", () => {
    const p = parseBoschEmail({
      subject: "Order confirmation",
      text: "Model: SMS6ZCI49E\nModel: WGG254Z0GB\nOrder date: 14/11/2024\n2 year guarantee, or extend to a 5 year warranty.",
      receivedAt: RECEIVED,
    })!;
    expect(p.fields.model).toBeNull();
    expect(p.modelOptions).toEqual(["SMS6ZCI49E", "WGG254Z0GB"]);
    expect(p.fields.warrantyYears).toBeNull();
    expect(p.fields.warrantyEnd).toBeNull();
  });

  it("missing purchase date: years found but no computed end", () => {
    const p = parseBoschEmail({ subject: "Order confirmation", text: "E-Nr: KGN39VWEAG\n2 year guarantee", receivedAt: RECEIVED })!;
    expect(p.fields.warrantyYears).toBe(2);
    expect(p.fields.warrantyEnd).toBeNull();
    expect(p.fields.warrantyComputed).toBe(false);
  });

  it("rejects a purchase date after the email arrived and lower-case lookalike codes", () => {
    const p = parseBoschEmail({ subject: "Order confirmation", text: "Model: sms6zci49e\nE-Nr: HBS534BS0B\nOrder date: 01/01/2030", receivedAt: RECEIVED })!;
    expect(p.fields.model).toBe("HBS534BS0B");
    expect(p.fields.purchaseDate).toBeNull();
  });

  it("returns null for marketing with no appliance", () => {
    expect(parseBoschEmail({ subject: "Autumn offers", text: "Save 20% on selected dishwashers this week.", receivedAt: RECEIVED })).toBeNull();
    expect(parseBoschEmail({ subject: "Newsletter", text: "Recipes and tips", receivedAt: RECEIVED })).toBeNull();
  });

  it("caps and cleans the product name", () => {
    const p = parseBoschEmail({ subject: "Order confirmation", text: `Product: <b>Series 4</b> ${"x".repeat(300)}\nE-Nr: SMS4HVI33G`, receivedAt: RECEIVED })!;
    expect(p.fields.productName!.length).toBeLessThanOrEqual(80);
    expect(p.fields.productName).not.toContain("<");
  });
});

const EON_RECEIVED = "2026-10-01T18:00:00.000Z";

describe("parseEonEmail", () => {
  it("reading confirmation: date, electricity and gas with unit", () => {
    const p = parseEonEmail({
      subject: "Thanks for your meter readings",
      text: "Thanks, we've received your readings.\nReading date: 1 October 2026\nElectricity reading: 12,345 kWh\nGas reading: 01234.5 m3\nMeter type: Standard",
      receivedAt: EON_RECEIVED,
    })!;
    expect(p.kind).toBe("reading");
    expect(p.fields).toEqual({
      readingDate: "2026-10-01",
      electricity: [{ register: "single", kwh: 12345 }],
      gas: { value: 1234.5, unit: "m3" },
      meterType: "standard",
    });
    expect(p.found).toMatchObject({ readingDate: true, electricity: true, gas: true, gasUnit: true, meterType: true, estimatedSkipped: false, ambiguous: false });
  });

  it("Economy 7 day and night registers from an HTML table", () => {
    const text = normaliseText(htmlToText(
      "<table><tr><td>Date of reading</td><td>30/09/2026</td></tr><tr><td>Day reading</td><td>04567</td></tr>" +
      "<tr><td>Night reading</td><td>02345</td></tr></table><p>Meter type: Economy 7</p>",
    ));
    const p = parseEonEmail({ subject: "Your readings", text, receivedAt: EON_RECEIVED })!;
    expect(p.fields.readingDate).toBe("2026-09-30");
    expect(p.fields.electricity).toEqual([{ register: "day", kwh: 4567 }, { register: "night", kwh: 2345 }]);
    expect(p.fields.meterType).toBe("economy7");
    expect(p.fields.gas).toBeNull();
  });

  it("bill: skips previous and estimated readings, takes the actual one", () => {
    const p = parseEonEmail({
      subject: "Your latest bill",
      text: "Previous electricity reading: 11800\nElectricity reading: 12345 (A)\nGas reading: 5000 (E)\nReading date: 28/09/2026",
      receivedAt: EON_RECEIVED,
    })!;
    expect(p.kind).toBe("bill");
    expect(p.fields.electricity).toEqual([{ register: "single", kwh: 12345 }]);
    expect(p.fields.gas).toBeNull();
    expect(p.found.estimatedSkipped).toBe(true);
  });

  it("gas without a stated unit keeps unit null; a date is not read as a reading", () => {
    const p = parseEonEmail({ subject: "Readings", text: "Gas reading: 4321\nElectricity reading date: 01/10/2026", receivedAt: EON_RECEIVED })!;
    expect(p.fields.gas).toEqual({ value: 4321, unit: null });
    expect(p.found.gasUnit).toBe(false);
    expect(p.fields.electricity).toEqual([]);
    expect(p.fields.readingDate).toBe("2026-10-01");
  });

  it("conflicting values leave the register empty; no reading -> null", () => {
    const p = parseEonEmail({ subject: "Readings", text: "Electricity reading: 100\nElectricity reading: 200\nGas reading: 50 ft3", receivedAt: EON_RECEIVED })!;
    expect(p.fields.electricity).toEqual([]);
    expect(p.found.ambiguous).toBe(true);
    expect(p.fields.gas).toEqual({ value: 50, unit: "ft3" });
    expect(parseEonEmail({ subject: "Get a smart meter", text: "Book your smart meter today.", receivedAt: EON_RECEIVED })).toBeNull();
  });

  it("rejects absurd values and future reading dates", () => {
    const p = parseEonEmail({ subject: "Readings", text: "Electricity reading: 123456789012\nGas reading: 77 m³\nReading date: 01/01/2030", receivedAt: EON_RECEIVED })!;
    expect(p.fields.electricity).toEqual([]);
    expect(p.fields.gas).toEqual({ value: 77, unit: "m3" });
    expect(p.fields.readingDate).toBeNull();
  });
});
