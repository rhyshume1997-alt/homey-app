import { z } from "zod";

/**
 * Household records: renewals, bills, budgets, property facts, contacts and so on.
 * Mirrors the master household record fields. Rules (D16):
 * - null means unknown, never zero;
 * - amounts are unverified until a person marks them verified;
 * - references store the last four characters only;
 * - historic values (snapshots, past bills) never overwrite current ones;
 * - the source of every record is kept.
 */
export const RECORD_LIMITS = { provider: 200, title: 500, frequency: 100, nextAction: 500, status: 200, source: 500, importKey: 200 } as const;

export const RecordCategorySchema = z.enum([
  "property",
  "purchase",
  "property_document",
  "mortgage",
  "mortgage_option",
  "banking",
  "insurance",
  "electricity",
  "gas",
  "broadband",
  "council_tax",
  "water",
  "factoring",
  "solar",
  "maintenance",
  "energy_efficiency",
  "household_finance",
  "contact",
  "project",
]);
export type RecordCategory = z.infer<typeof RecordCategorySchema>;

/** What a number means. Money is GBP; kWh values are energy, never money. */
export const RecordUnitSchema = z.enum(["GBP", "kWh"]);

/**
 * How trustworthy a figure is:
 * budget (planned in the spreadsheet), bill (an issued bill), estimate, snapshot (a dated
 * balance, historic), contract (agreed terms, e.g. principal or purchase price), proposal.
 */
export const AmountKindSchema = z.enum(["budget", "bill", "estimate", "snapshot", "contract", "proposal"]);

export const HouseholdRecordSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  category: RecordCategorySchema,
  provider: z.string().max(RECORD_LIMITS.provider).nullable(),
  title: z.string().min(1).max(RECORD_LIMITS.title),
  amount: z.number().nullable(),
  unit: RecordUnitSchema.nullable(),
  amount_kind: AmountKindSchema.nullable(),
  /** Free text as recorded, e.g. "monthly budget", "annual estimated". */
  frequency: z.string().max(RECORD_LIMITS.frequency).nullable(),
  start_date: z.iso.date().nullable(),
  renewal_date: z.iso.date().nullable(),
  end_date: z.iso.date().nullable(),
  next_action: z.string().max(RECORD_LIMITS.nextAction).nullable(),
  reference_last4: z.string().length(4).nullable(),
  status: z.string().max(RECORD_LIMITS.status).nullable(),
  source: z.string().max(RECORD_LIMITS.source).nullable(),
  verified: z.boolean(),
  /** Date the information was true as of (e.g. the master record's as_of). */
  as_of: z.iso.date().nullable(),
  /** Stable key so re-running an import never duplicates. Null for records added in the app. */
  import_key: z.string().max(RECORD_LIMITS.importKey).nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HouseholdRecord = z.infer<typeof HouseholdRecordSchema>;
