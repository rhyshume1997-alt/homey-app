/**
 * Email import (D18): drafts of appliance records and meter readings read from allowlisted senders
 * (Bosch, E.ON) through the member's own read-only Gmail sign-in (D17).
 *
 * Kept free of zod and of server code so client components can import the types and constants.
 * A draft holds only extracted, validated fields: never the email body, addresses or links.
 * Nothing is saved until a person confirms a draft; the server then re-fetches and re-parses the
 * email by message id and hands the confirmed record to an injected saver (below).
 */

/** Rooms (D18), for the optional room on an imported appliance. */
export const IMPORT_ROOMS = [
  "Living room", "WC", "Kitchen", "Office bedroom", "Main bedroom", "Spare bedroom", "Bathroom",
  "Understairs cupboard", "Washing machine cupboard", "Laundry cupboard",
] as const;
export type ImportRoom = (typeof IMPORT_ROOMS)[number];

export const IMPORT_LIMITS = {
  model: 40,
  productName: 80,
  subject: 120,
  /** Largest meter reading accepted (kWh or gas units). */
  readingMax: 9_999_999,
} as const;

export type ImportKind = "appliances" | "readings";
export type ImportSender = "Bosch" | "E.ON";

/** Where a draft came from. messageHash is sha256(Gmail message id), the only id ever stored. */
export interface EmailSource {
  sender: ImportSender;
  /** The authenticated sender domain (exact allowlist match). */
  domain: string;
  /** ISO timestamp the email was received (Gmail internalDate). */
  receivedAt: string;
  /** Cleaned subject, no links, at most IMPORT_LIMITS.subject characters. */
  subject: string;
  messageHash: string;
}

// ---- appliances (Bosch) -----------------------------------------------------------------

export type BoschEmailKind = "order" | "registration" | "warranty" | "other";

export interface ApplianceFields {
  make: "Bosch";
  model: string | null;
  productName: string | null;
  /** yyyy-mm-dd */
  purchaseDate: string | null;
  /** yyyy-mm-dd */
  warrantyEnd: string | null;
  /** True when warrantyEnd was worked out as purchase date + stated years. */
  warrantyComputed: boolean;
  /** Years stated in the email ("2 year guarantee"), when found. */
  warrantyYears: number | null;
}

export interface ApplianceFound {
  model: boolean;
  productName: boolean;
  purchaseDate: boolean;
  warrantyEnd: boolean;
  warrantyYears: boolean;
}

export interface ApplianceDraft {
  /** Gmail message id, used only to re-fetch on save. Never stored. */
  messageId: string;
  source: EmailSource;
  kind: BoschEmailKind;
  fields: ApplianceFields;
  found: ApplianceFound;
  /** Several different model codes were found, so model is null: these are the options (max 5). */
  modelOptions: string[];
}

// ---- meter readings (E.ON) --------------------------------------------------------------

export type ElectricityRegister = "single" | "day" | "night";
export interface ElectricityReading { register: ElectricityRegister; kwh: number }
export type GasUnit = "m3" | "ft3";
export interface GasReading { value: number; unit: GasUnit | null }
export type MeterType = "smart" | "standard" | "economy7" | "prepayment";
export type EonEmailKind = "reading" | "bill" | "other";

export interface ReadingFields {
  /** yyyy-mm-dd */
  readingDate: string | null;
  electricity: ElectricityReading[];
  gas: GasReading | null;
  meterType: MeterType | null;
}

export interface ReadingFound {
  readingDate: boolean;
  electricity: boolean;
  gas: boolean;
  gasUnit: boolean;
  meterType: boolean;
  /** Readings marked estimated were seen and left out. */
  estimatedSkipped: boolean;
  /** Conflicting values were seen for a register, so it was left empty. */
  ambiguous: boolean;
}

export interface ReadingDraft {
  messageId: string;
  source: EmailSource;
  kind: EonEmailKind;
  fields: ReadingFields;
  found: ReadingFound;
}

// ---- results and savers -----------------------------------------------------------------

export type DraftList<D> =
  | { status: "ok"; drafts: D[] }
  | { status: "not_connected" }
  | { status: "error"; message: string };

export type CandidateCounts =
  | { status: "ok"; appliances: number; readings: number }
  | { status: "not_connected" }
  | { status: "error" };

/** Result of a save server action. Messages are fixed, user-facing text only. */
export type ImportActionState = { ok?: boolean; error?: string; saved?: string } | null;

/** Identity the saver writes as. household_id comes from the server session, never the form. */
export interface SaverSession { userId: string; householdId: string }

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Source label every saved record carries. edited: the person changed a value before saving. */
export interface ConfirmedSource extends EmailSource { edited: boolean }

export interface ConfirmedAppliance {
  make: "Bosch";
  model: string | null;
  productName: string | null;
  purchaseDate: string | null;
  warrantyEnd: string | null;
  /** email: stated in the email; computed: purchase + stated years; edited: typed by the person. */
  warrantyEndSource: "email" | "computed" | "edited" | null;
  room: ImportRoom | null;
  source: ConfirmedSource;
}

export interface ConfirmedReading {
  readingDate: string;
  electricity: ElectricityReading[];
  gas: { value: number; unit: GasUnit } | null;
  meterType: MeterType | null;
  source: ConfirmedSource;
}

/**
 * Implemented by the appliances module and wired by the orchestrator. Called only after a person
 * pressed Save and the server re-read the email. Should be idempotent on source.messageHash.
 */
export interface ApplianceSaver {
  save(session: SaverSession, appliance: ConfirmedAppliance): Promise<SaveResult>;
  /** Optional: which of these message hashes are already saved, so they are not offered again. */
  importedHashes?(session: SaverSession, hashes: string[]): Promise<ReadonlySet<string>>;
}

/** Implemented by the meter-readings module and wired by the orchestrator. Same rules as above. */
export interface ReadingSaver {
  save(session: SaverSession, reading: ConfirmedReading): Promise<SaveResult>;
  importedHashes?(session: SaverSession, hashes: string[]): Promise<ReadonlySet<string>>;
}
