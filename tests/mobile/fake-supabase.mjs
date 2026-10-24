// TEST ONLY. Fake Supabase (GoTrue + PostgREST subset) serving made-up data for phone layout tests.
// Never deployed: lives under tests/, started only by playwright.mobile.config.ts.
import http from "node:http";

const H = "0000aaaa-0000-4000-8000-000000000001";
const RHYS = "0000bbbb-0000-4000-8000-000000000001";
const RACHEL = "0000bbbb-0000-4000-8000-000000000002";
const now = new Date("2026-10-21T12:00:00Z");
const iso = (dMin) => new Date(now.getTime() - dMin * 60000).toISOString();
let n = 0;
const uid = () => `0000cccc-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const members = [
  { household_id: H, user_id: RHYS, role: "owner", display_name: "Alex", status: "active", households: { name: "Test household" }, created_at: iso(9000) },
  { household_id: H, user_id: RACHEL, role: "owner", display_name: "Sam", status: "active", households: { name: "Test household" }, created_at: iso(9000) },
];
const task = (title, o = {}) => ({
  id: uid(), household_id: H, title, notes: null, assignee_user_id: null, due_date: null,
  recurrence: "none", status: "open", completed_at: null, completed_by: null, created_by: RHYS,
  created_at: iso(3000), updated_at: iso(3000), next_task_id: null, ...o,
});
const tasks = [
  task("Bleed the radiators", { due_date: "2026-10-18", assignee_user_id: RHYS }),
  task("Clean the oven", { due_date: "2026-10-21", assignee_user_id: RACHEL }),
  task("Take the recycling out", { due_date: "2026-10-21", recurrence: "weekly" }),
  task("Change the bedding", { due_date: "2026-10-24", recurrence: "weekly", assignee_user_id: RACHEL }),
  task("Book boiler service", { due_date: "2026-11-02", assignee_user_id: RHYS, notes: "Annual service" }),
  task("Sort the loft boxes"),
  task("Hoover the stairs", { status: "done", completed_at: iso(200), completed_by: RACHEL, due_date: "2026-10-20" }),
];
const snag = (title, o = {}) => ({
  id: uid(), household_id: H, title, location: null, notes: null, status: "open", priority: "medium",
  fixed_at: null, created_by: RACHEL, created_at: iso(5000), updated_at: iso(5000), ...o,
});
const snags = [
  snag("Dripping kitchen tap", { location: "Kitchen", priority: "high" }),
  snag("Bathroom extractor fan noisy", { location: "Bathroom", status: "reported" }),
  snag("Sticking bedroom door", { location: "Main bedroom", priority: "low", status: "in_progress" }),
  snag("Cracked grout by the shower", { location: "Bathroom" }),
  snag("Loose stair rod", { location: "Stairs", status: "fixed", fixed_at: iso(1500) }),
];
let aid = 100;
const ev = (min, actor, action, entity_type, summary, entity_id = null) => ({
  id: aid--, household_id: H, actor_user_id: actor, action, entity_type, entity_id, summary,
  before: null, after: null, created_at: iso(min),
});
const audit_log = [
  ev(12, RACHEL, "household.event", "event", "Put a washing on", "washing.on"),
  ev(45, RHYS, "task.completed", "task", "Hoover the stairs"),
  ev(90, RACHEL, "snag.created", "snag", "Cracked grout by the shower"),
  ev(180, RHYS, "household.event", "event", "Started the dishwasher", "dishwasher.started"),
  ev(300, RACHEL, "task.created", "task", "Change the bedding"),
  ev(1500, RHYS, "snag.fixed", "snag", "Loose stair rod"),
  ev(1600, RACHEL, "household.event", "event", "Bought supplies: milk and bin bags", "supplies.bought"),
  ev(2900, RHYS, "task.created", "task", "Book boiler service"),
];
const rec = (o) => ({
  id: uid(), household_id: H, provider: null, amount: null, unit: null, amount_kind: null, frequency: null,
  start_date: null, renewal_date: null, end_date: null, next_action: null, reference_last4: null, status: null,
  source: "synthetic test data", verified: false, as_of: null, import_key: null, created_by: null,
  created_at: iso(4000), updated_at: iso(4000), ...o,
});
const household_records = [
  rec({ category: "insurance", provider: "Example Insurer", title: "Home insurance renewal", renewal_date: "2026-11-20", next_action: "Compare quotes before renewal", reference_last4: "1234" }),
  rec({ category: "broadband", provider: "Example Broadband", title: "Contract ends", end_date: "2026-10-01", renewal_date: "2027-01-15" }),
  rec({ category: "mortgage", provider: "Example Lender", title: "Fixed rate ends", end_date: "2028-03-01" }),
  rec({ category: "broadband", provider: "Example Broadband", title: "Broadband", amount: 1234.56, unit: "GBP", amount_kind: "estimate", frequency: "annual estimated" }),
  rec({ category: "electricity", provider: "Example Energy", title: "Electricity budget", amount: 95, unit: "GBP", amount_kind: "budget", frequency: "monthly budget", verified: true }),
  rec({ category: "electricity", provider: "Example Energy", title: "Electricity usage", amount: 3100, unit: "kWh", amount_kind: "estimate", frequency: "annual" }),
  rec({ category: "council_tax", title: "Council tax", amount: 160.5, unit: "GBP", amount_kind: "bill", frequency: "monthly" }),
];
const ymd = (dDays) => new Date(now.getTime() + dDays * 86400000).toISOString().slice(0, 10);
const bin_collections = [0, 1, 2, 3, 4, 5].flatMap((w) => [
  { id: uid(), household_id: H, collection_date: ymd(1 + w * 7), bin_name: w % 2 ? "Green recycling bin" : "Grey general waste bin", source: "synthetic", received_at: iso(600) },
  { id: uid(), household_id: H, collection_date: ymd(3 + w * 7), bin_name: "Brown garden waste bin", source: "synthetic", received_at: iso(600) },
]);
const doc = (title, category, o = {}) => ({
  id: uid(), household_id: H, title, category, mime_type: "application/pdf", size_bytes: 120000, issued_on: null,
  expires_on: null, renewal_date: null, record_id: null, notes: null, created_at: iso(2000), ...o,
});
const documents = [
  doc("Boiler warranty (synthetic)", "warranty", { expires_on: ymd(30) }),
  doc("Home insurance schedule (synthetic)", "insurance", { issued_on: "2026-01-10" }),
  doc("Mortgage offer (synthetic)", "mortgage"),
];
const shopping_items = [
  { id: uid(), household_id: H, title: "Milk", quantity: "2", shop: "Corner shop", done: false, done_at: null, created_at: iso(500) },
  { id: uid(), household_id: H, title: "Bin bags", quantity: null, shop: null, done: false, done_at: null, created_at: iso(400) },
  { id: uid(), household_id: H, title: "Washing up liquid", quantity: null, shop: null, done: true, done_at: iso(60), created_at: iso(300) },
];
const supplies = [
  { id: uid(), household_id: H, name: "Dishwasher tablets", location: "Under sink", status: "low", notes: null, last_checked_at: iso(1000) },
  { id: uid(), household_id: H, name: "Toilet roll", location: "Cupboard", status: "ok", notes: null, last_checked_at: iso(1000) },
  { id: uid(), household_id: H, name: "Bin bags", location: null, status: "out", notes: null, last_checked_at: null },
];
const maintenance_items = [
  { id: uid(), household_id: H, title: "Service the boiler", area: "Utility", interval_months: 12, season: "autumn", last_done_on: "2025-10-01", next_due_on: ymd(-3), notes: null, provider: null, created_at: iso(5000), updated_at: iso(5000) },
  { id: uid(), household_id: H, title: "Clear the gutters", area: "Outside", interval_months: 6, season: "autumn", last_done_on: null, next_due_on: ymd(12), notes: null, provider: null, created_at: iso(5000), updated_at: iso(5000) },
  { id: uid(), household_id: H, title: "Test smoke alarms", area: null, interval_months: 1, season: null, last_done_on: null, next_due_on: null, notes: null, provider: null, created_at: iso(5000), updated_at: iso(5000) },
];
const maintenance_log = [
  { id: uid(), item_id: maintenance_items[0].id, done_on: "2025-10-01", notes: "Annual service", cost_gbp: null, created_at: iso(9000) },
];
const notifications = [
  { id: uid(), household_id: H, recipient_user_id: null, kind: "bin_tomorrow", title: "Bins go out tonight", body: "Green recycling bin", link: "/bins", dedupe_key: "a", created_at: iso(30), notification_reads: [] },
  { id: uid(), household_id: H, recipient_user_id: null, kind: "task_overdue", title: "Overdue: Bleed the radiators", body: null, link: "/tasks", dedupe_key: "b", created_at: iso(200), notification_reads: [] },
  { id: uid(), household_id: H, recipient_user_id: null, kind: "system", title: "Welcome (read)", body: null, link: null, dedupe_key: "c", created_at: iso(900), notification_reads: [{ user_id: RHYS }] },
];
const email_threads = [
  { id: uid(), household_id: H, thread_hash: "h1", member: "Alex", subject: "Refund request (synthetic)", counterpart_domain: "example-shop.invalid", last_message_at: iso(60 * 24 * 4), last_from: "me", labelled: true, status: "awaiting", updated_at: iso(100) },
  { id: uid(), household_id: H, thread_hash: "h2", member: "Sam", subject: "Quote for fence (synthetic)", counterpart_domain: "example-fencing.invalid", last_message_at: iso(60 * 24 * 9), last_from: "me", labelled: false, status: "awaiting", updated_at: iso(100) },
  { id: uid(), household_id: H, thread_hash: "h3", member: "Alex", subject: "Parcel (synthetic)", counterpart_domain: "example-post.invalid", last_message_at: iso(60 * 24), last_from: "them", labelled: true, status: "replied", updated_at: iso(100) },
];
const ai_usage = [{ id: uid(), household_id: H, user_id: RHYS, month: ymd(0).slice(0, 8) + "01", model: "claude-test", input_tokens: 100, output_tokens: 50, cost_pence: 3, created_at: iso(100) }];
const ai_proposals = [
  { id: uid(), household_id: H, kind: "add_shopping_item", payload: { title: "Light bulbs" }, status: "pending", created_by: RHYS, created_at: iso(20), updated_at: iso(20) },
];
// D18 tables (synthetic, clearly fake data).
const ROOM_KITCHEN = "0000d18a-0000-4000-8000-000000000001";
const rooms = ["Living room", "WC", "Kitchen", "Office bedroom", "Main bedroom", "Spare bedroom", "Bathroom", "Understairs cupboard", "Washing machine cupboard", "Laundry cupboard"]
  .map((name, i) => ({ id: name === "Kitchen" ? ROOM_KITCHEN : uid(), household_id: H, name, sort_order: (i + 1) * 10, notes: name === "Kitchen" ? "Back wall 3.40 m (synthetic)" : null, created_by: RHYS, created_at: iso(500), updated_at: iso(500) }));
const wishlist_items = [
  { id: uid(), household_id: H, room_id: ROOM_KITCHEN, title: "Bar stools x2 (synthetic)", price_estimate: 120, url: "https://example.invalid/stools", priority: "medium", status: "idea", photo_document_id: null, notes: null, bought_at: null, created_by: RHYS, created_at: iso(300), updated_at: iso(300) },
];
const checklist_items = [
  { id: uid(), household_id: H, title: "Bleed radiators", season: "autumn", frequency: "yearly", month: 10, room_id: null, last_done_on: null, next_due_on: ymd(-3), notes: null, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
  { id: uid(), household_id: H, title: "Test smoke alarms", season: "any", frequency: "monthly", month: null, room_id: null, last_done_on: null, next_due_on: ymd(5), notes: null, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
];
const emergency_items = [
  { id: uid(), household_id: H, section: "location", label: "Stopcock", detail: "Not set yet", sort_order: 10, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
  { id: uid(), household_id: H, section: "step", label: "Boiler reset", detail: "Not set yet", sort_order: 10, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
  { id: uid(), household_id: H, section: "number", label: "Gas emergency", detail: "0800 111 999", sort_order: 10, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
];
const household_events = [
  { id: uid(), household_id: H, title: "Boiler engineer visit (synthetic)", starts_on: ymd(2), starts_at: "10:00:00", ends_on: null, all_day: false, room_id: ROOM_KITCHEN, notes: null, created_by: RHYS, created_at: iso(100), updated_at: iso(100) },
];
const appliances = [
  { id: "0000d18a-0000-4000-8000-000000000002", household_id: H, room_id: ROOM_KITCHEN, name: "Dishwasher (synthetic)", make: "Bosch", model: "SMS-EXAMPLE", serial_last4: null, purchase_date: ymd(-340), warranty_end: ymd(20), source: "manual", source_message_hash: null, manual_document_id: null, receipt_document_id: null, notes: null, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
];
const meter_readings = [
  { id: uid(), household_id: H, fuel: "electricity", read_on: ymd(-30), value: 12000, unit: "kWh", source: "manual", source_message_hash: null, note: null, created_by: RHYS, created_at: iso(500), updated_at: iso(500) },
  { id: uid(), household_id: H, fuel: "electricity", read_on: ymd(-1), value: 12240, unit: "kWh", source: "manual", source_message_hash: null, note: null, created_by: RHYS, created_at: iso(10), updated_at: iso(10) },
];
const MEAL_ID = "0000d18a-0000-4000-8000-000000000003";
// The app reads the real clock for "this week", so plan meals relative to the real Monday (day 0 = Monday).
const realMonday = new Date(Date.now() - ((new Date().getUTCDay() + 6) % 7) * 86400000);
const mealDay = (d) => new Date(realMonday.getTime() + d * 86400000).toISOString().slice(0, 10);
const mealRow = (id, day, slot, title, notes = null) => ({ id, household_id: H, planned_on: mealDay(day), slot, title, notes, created_by: RHYS, created_at: iso(100), updated_at: iso(100) });
// Dates are relative to the fake clock; several days and both slots, long titles, long ingredient names.
const meals = [
  { ...mealRow(MEAL_ID, 0, "dinner", "Veg chilli (synthetic)") },
  mealRow(uid(), 0, "lunch", "Slow roasted shoulder of lamb with rosemary, garlic, anchovies and a very long side of seasonal roasted vegetables (synthetic)", "Start the marinade the night before and remember to take it out of the fridge an hour ahead of cooking."),
  mealRow(uid(), 1, "dinner", "Supercalifragilisticexpialidocious_pasta_bake_without_any_spaces_at_all_synthetic"),
  mealRow(uid(), 2, "lunch", "Soup"),
  mealRow(uid(), 2, "dinner", "Fish pie"),
  mealRow(uid(), 4, "dinner", "Homemade pizza night with all the toppings (synthetic)"),
  mealRow(uid(), 6, "lunch", "Sunday roast"),
];
const ing = (meal_id, name, quantity, price) => ({ id: uid(), household_id: H, meal_id, name, quantity, unit_price_estimate: price, supply_id: null, created_by: RHYS, created_at: iso(100), updated_at: iso(100) });
const meal_ingredients = [
  ing(MEAL_ID, "Kidney beans", "2 tins", 0.8),
  ing(MEAL_ID, "Chopped tomatoes", "3 tins", 0.65),
  ing(meals[1].id, "Extra virgin cold pressed Greek olive oil from a single estate (synthetic)", "500ml bottle, the big one", 7.5),
  ing(meals[1].id, "Rosemary", "1 bunch", null),
  ing(meals[2].id, "Wholewheat_penne_pasta_quills_no_spaces_in_this_name_at_all", "500g", 1.2),
  ing(meals[2].id, "Kidney beans", "1 tin", 0.8),
  ing(meals[4].id, "Smoked haddock", "400g", 4.5),
  ing(meals[5].id, "Strong white bread flour", "1kg", 1.4),
];
const bin_schedules = [
  { id: "0000b1d5-0000-4000-8000-000000000001", household_id: H, bin_name: "Recycling (made up)", colour: "blue", first_date: ymd(2), every_weeks: 2, created_by: RHYS, created_at: iso(100), updated_at: iso(100) },
  { id: "0000b1d5-0000-4000-8000-000000000002", household_id: H, bin_name: "Food waste (made up)", colour: "brown", first_date: ymd(4), every_weeks: 1, created_by: RHYS, created_at: iso(100), updated_at: iso(100) },
];
const bin_settings = [
  { household_id: H, council_url: "https://www.example.invalid/a-very-long-made-up-council-bin-collection-page/with/a/long/path?postcode=XX1", updated_at: iso(100), updated_by: RHYS },
];
for (const m of meals) m.meal_ingredients = meal_ingredients.filter((i) => i.meal_id === m.id);
const tables = {
  rooms, wishlist_items, checklist_items, emergency_items, wifi_networks: [], household_events, appliances, meter_readings,
  meals, meal_ingredients, kudos: [], ai_digests: [],
  household_records, household_members: members, household_invites: [], tasks, snags, audit_log, bin_collections, bin_schedules, bin_settings, documents, shopping_items,
  supplies, maintenance_items, maintenance_log, notifications, notification_reads: [], email_threads, ai_usage,
  ai_proposals, push_subscriptions: [], budget_snapshots: [],
};

function applyQuery(rows, params) {
  let out = rows.slice();
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const m = v.match(/^(not\.)?(eq|neq|lt|lte|gt|gte|is)\.(.*)$/);
    if (!m) continue;
    const [, not, op, raw] = m;
    const val = raw === "null" ? null : raw;
    const test = (x) => {
      const a = x[k];
      switch (op) {
        case "eq": return String(a) === val;
        case "neq": return String(a) !== val;
        case "lt": return a !== null && (typeof a === "number" ? a < Number(val) : a < val);
        case "lte": return a !== null && (typeof a === "number" ? a <= Number(val) : a <= val);
        case "gt": return a !== null && (typeof a === "number" ? a > Number(val) : a > val);
        case "gte": return a !== null && (typeof a === "number" ? a >= Number(val) : a >= val);
        case "is": return a === val;
      }
    };
    out = out.filter((x) => (not ? !test(x) : test(x)));
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  const sel = params.get("select");
  if (sel && sel !== "*") {
    // "notification_reads(user_id)" embeds are already stored on the row under the relation name.
    // Split on top-level commas only, so embeds like meal_ingredients(a,b) stay one column.
    const cols = [];
    let depth = 0, cur = "";
    for (const ch of sel) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { cols.push(cur); cur = ""; } else cur += ch;
    }
    cols.push(cur);
    for (let i = 0; i < cols.length; i++) cols[i] = cols[i].trim().replace(/\(.*\)$/, "");
    out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }
  return out;
}

const user = { id: RHYS, aud: "authenticated", role: "authenticated", email: "test@example.invalid",
  app_metadata: { provider: "google" }, user_metadata: {}, created_at: iso(9000) };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") { res.end("ok"); return; }
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/auth/v1/user") return send(200, user);
  const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (m && req.method === "GET" && tables[m[1]]) {
    const rows = applyQuery(tables[m[1]], url.searchParams);
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return rows.length ? send(200, rows[0]) : send(406, { code: "PGRST116" });
    return send(200, rows);
  }
  // RPCs the pages call on load (refresh_my_notifications and friends): succeed with no result.
  if (req.method === "POST" && /^\/rest\/v1\/rpc\/[a-z_]+$/.test(url.pathname)) { req.resume(); return send(200, null); }
  // Writes are not supported in the preview.
  send(403, { message: "preview is read-only" });
}).listen(Number(process.env.FAKE_SUPABASE_PORT ?? 54329), "127.0.0.1", () => console.log("fake supabase ready"));
