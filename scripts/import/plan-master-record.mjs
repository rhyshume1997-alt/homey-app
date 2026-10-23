#!/usr/bin/env node
// Usage: node scripts/import/plan-master-record.mjs <input.json> --household <uuid> [--sql private/out.sql]
// Plans an import of an "Our Home Master Record" JSON. Never connects to a database.
// Needs Node >= 22.18 (runs the TypeScript mapping via native type stripping).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planImport, buildSql } from "./mapping.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateDir = path.join(repoRoot, "private");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let input = null;
let household = null;
let sqlOut = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--household") household = args[++i];
  else if (args[i] === "--sql") sqlOut = args[++i] ?? "";
  else if (args[i].startsWith("--")) fail(`unknown option ${args[i]}`);
  else if (input === null) input = args[i];
  else fail("only one input file is allowed");
}
if (!input || !household) fail("usage: plan-master-record.mjs <input.json> --household <uuid> [--sql private/out.sql]");
if (!UUID_RE.test(household)) fail("--household must be a uuid");

// Resolve the SQL target up front and refuse anything outside private/ (symlinks included).
let sqlPath = null;
if (sqlOut !== null) {
  if (!sqlOut) fail("--sql needs a path");
  sqlPath = path.resolve(sqlOut);
  const rel = path.relative(privateDir, sqlPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) fail("--sql must point to a file under private/ (personal data stays in the ignored folder)");
  fs.mkdirSync(privateDir, { recursive: true }); // ignored folder; created on demand
  let probe = path.dirname(sqlPath);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  const realPrivate = fs.realpathSync(privateDir);
  const relReal = path.relative(realPrivate, realProbe);
  if (relReal.startsWith("..") || path.isAbsolute(relReal)) fail("--sql resolves outside private/");
}

let record;
try {
  record = JSON.parse(fs.readFileSync(input, "utf8"));
} catch (e) {
  fail(`cannot read input JSON: ${e instanceof Error ? e.message : "unknown error"}`);
}
if (!record || !Array.isArray(record.items)) fail("input has no items array");

const plan = planImport(record, household);
const sql = buildSql(plan);

const fmtAmount = (n) => (n === null ? "-" : String(n));
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

console.log(`Master record: ${record.name ?? "(unnamed)"}, as of ${record.as_of ?? "unknown"}`);
console.log(`Household block: ${plan.household ? "present (returned in the plan, not printed)" : "absent"}`);
console.log("");
console.log("Targets");
console.log(`  household_records: ${plan.records.length}`);
console.log(`  snags:             ${plan.snags.length}`);
console.log(`  tasks:             ${plan.tasks.length}`);
console.log(`  warnings:          ${plan.warnings.length}`);
console.log("");
console.log("household_records");
console.log(["category".padEnd(18), "provider".padEnd(22), "title".padEnd(40), "amount".padStart(10), "unit".padEnd(4), "kind"].join("  "));
for (const r of plan.records) {
  console.log([
    r.category.padEnd(18), trunc(r.provider ?? "-", 22).padEnd(22), trunc(r.title, 40).padEnd(40),
    fmtAmount(r.amount).padStart(10), (r.unit ?? "-").padEnd(4), r.amount_kind ?? "-",
  ].join("  "));
}
console.log("");
console.log("snags");
for (const s of plan.snags) console.log(`  [${s.status}/${s.priority}] ${trunc(s.title, 80)}`);
console.log("");
console.log("tasks");
for (const t of plan.tasks) console.log(`  ${t.due_date}  ${t.title} (recurrence ${t.recurrence})`);
console.log("");
console.log("warnings");
if (plan.warnings.length === 0) console.log("  none");
for (const w of plan.warnings) console.log(`  - ${w}`);

if (sqlPath) {
  fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  console.log(`\nSQL written to ${path.relative(repoRoot, sqlPath)} (not applied; review before running).`);
} else {
  console.log("\nNo --sql given: nothing written.");
}
