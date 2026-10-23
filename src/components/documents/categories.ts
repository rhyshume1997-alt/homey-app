/** Document categories and labels without zod, so the client upload form stays small. */

export const DOCUMENT_CATEGORIES = [
  "property", "mortgage", "insurance", "energy", "solar", "warranty", "council", "identity", "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  property: "Property",
  mortgage: "Mortgage",
  insurance: "Insurance",
  energy: "Energy",
  solar: "Solar",
  warranty: "Warranty",
  council: "Council",
  identity: "Identity",
  other: "Other",
};
