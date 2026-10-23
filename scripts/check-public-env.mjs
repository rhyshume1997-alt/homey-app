import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
]);
const root = fileURLToPath(new URL("../src", import.meta.url));
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Za-z0-9_]*/g)) {
        if (!ALLOWED.has(m[0])) bad.push(`${p}: ${m[0]}`);
      }
    }
  }
}
walk(root);

if (bad.length) {
  console.error("Disallowed NEXT_PUBLIC_ identifiers:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("check-public-env: ok");
