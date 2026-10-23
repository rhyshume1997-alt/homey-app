// Generates the install icons and iPhone splash screens from one Homey drawing.
// Run: CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/icons/generate.mjs
// Needs Playwright + Chromium only (no extra dependencies).
import pw from "playwright";
const { chromium } = pw;
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const icons = join(root, "public/icons");
const splash = join(root, "public/splash");
mkdirSync(icons, { recursive: true });
mkdirSync(splash, { recursive: true });

// Homey, drawn in a 200x200 box.
const homeyDefs = (id) => `
  <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd4f5"/><stop offset="1" stop-color="#5fa8d8"/></linearGradient>
  <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
const homey = (id) => `
  <path d="M100 16 L180 84 Q188 91 188 102 V158 Q188 182 164 182 H36 Q12 182 12 158 V102 Q12 91 20 84 Z" fill="url(#${id}g)" stroke="#d6eefc" stroke-opacity=".7" stroke-width="3" stroke-linejoin="round"/>
  <path d="M100 24 L172 86 Q178 92 178 100 V120 Q100 96 22 120 V100 Q22 92 28 86 Z" fill="url(#${id}s)"/>
  <ellipse cx="72" cy="112" rx="11" ry="14" fill="#13233a"/><ellipse cx="128" cy="112" rx="11" ry="14" fill="#13233a"/>
  <circle cx="76" cy="106" r="4.2" fill="#fff"/><circle cx="132" cy="106" r="4.2" fill="#fff"/>
  <circle cx="70" cy="117" r="1.8" fill="#fff" fill-opacity=".8"/><circle cx="126" cy="117" r="1.8" fill="#fff" fill-opacity=".8"/>
  <path d="M80 142 Q100 160 120 142" fill="none" stroke="#13233a" stroke-width="6" stroke-linecap="round"/>`;

/** Icon SVG on a 512 canvas. homeySize = Homey width in px; radius = corner radius (0 = full bleed). */
function iconSvg({ homeySize, radius }) {
  const s = homeySize / 200;
  const o = (512 - homeySize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2140"/><stop offset="1" stop-color="#16131d"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b4a2ec" stop-opacity=".28"/><stop offset="1" stop-color="#b4a2ec" stop-opacity="0"/></radialGradient>
    ${homeyDefs("h")}
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="${homeySize * 0.85}" fill="url(#glow)"/>
  <g transform="translate(${o} ${o + homeySize * 0.01}) scale(${s})">${homey("h")}</g>
</svg>`;
}

const variants = {
  "icon.svg": iconSvg({ homeySize: 300, radius: 112 }),
  "icon-maskable.svg": iconSvg({ homeySize: 270, radius: 0 }), // inside the 80% safe zone
  "apple.svg": iconSvg({ homeySize: 300, radius: 0 }),
};
writeFileSync(join(icons, "icon.svg"), variants["icon.svg"]);
writeFileSync(join(icons, "icon-maskable.svg"), variants["icon-maskable.svg"]);

// [pixel w, pixel h, css w, css h, dpr]
const SPLASH = [
  [1179, 2556, 393, 852, 3], [1290, 2796, 430, 932, 3], [1170, 2532, 390, 844, 3],
  [1284, 2778, 428, 926, 3], [1125, 2436, 375, 812, 3], [828, 1792, 414, 896, 2],
  [750, 1334, 375, 667, 2], [1206, 2622, 402, 874, 3], [1320, 2868, 440, 956, 3],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function render(html, w, h, out, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:${transparent ? "transparent" : "#16131d"}}svg{display:block}</style>${html}`);
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
}
const sized = (svg, px) => svg.replace('width="512" height="512"', `width="${px}" height="${px}"`);

await render(sized(variants["icon.svg"], 512), 512, 512, join(icons, "icon-512.png"), true);
await render(sized(variants["icon.svg"], 192), 192, 192, join(icons, "icon-192.png"), true);
await render(sized(variants["icon-maskable.svg"], 512), 512, 512, join(icons, "icon-maskable-512.png"));
await render(sized(variants["apple.svg"], 180), 180, 180, join(icons, "apple-touch-icon.png"));

for (const [w, h] of SPLASH) {
  const hs = Math.round(w * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b4a2ec" stop-opacity=".16"/><stop offset="1" stop-color="#b4a2ec" stop-opacity="0"/></radialGradient>${homeyDefs("h")}</defs>
  <rect width="${w}" height="${h}" fill="#16131d"/>
  <g transform="translate(${(w - hs) / 2} ${h * 0.45 - hs / 2}) scale(${hs / 200})">${homey("h")}</g>
  <text x="${w / 2}" y="${h * 0.45 + hs / 2 + w * 0.12}" text-anchor="middle" font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif" font-weight="600" font-size="${Math.round(w * 0.075)}" fill="#dfdae8">Our Home</text>
</svg>`;
  await render(svg, w, h, join(splash, `splash-${w}x${h}.png`));
}
await browser.close();
console.log("done");
