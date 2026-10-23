import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  /sb_secret_/,
  /service_role/,
  /sk-ant-/,
  /-----BEGIN/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ya29\./,
  /GOCSPX-/,
  /SUPABASE_SERVICE_ROLE/,
];
const root = fileURLToPath(new URL("../.next/static", import.meta.url));
if (!existsSync(root)) {
  console.error("scan-bundle: .next/static not found; run `npm run build` first");
  process.exit(1);
}
let files = 0;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      files++;
      const text = readFileSync(p, "utf8");
      for (const re of PATTERNS) if (re.test(text)) hits.push(`${p}: ${re}`);
    }
  }
}
walk(root);

if (hits.length) {
  console.error("Secret patterns found in client bundle:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`scan-bundle: ok (${files} files scanned)`);
