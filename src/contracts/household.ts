import { z } from "zod";

/** Limits mirror supabase/migrations/20261021120000_foundation.sql. */
export const LIMITS = {
  householdName: 100,
  displayName: 50,
  action: 64,
  entityType: 64,
  entityId: 128,
  summary: 500,
} as const;

export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(LIMITS.householdName),
  created_at: z.string(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const HouseholdRoleSchema = z.enum(["owner", "member"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdMemberSchema = z.object({
  household_id: z.uuid(),
  user_id: z.uuid(),
  role: HouseholdRoleSchema,
  display_name: z.string().min(1).max(LIMITS.displayName),
  created_at: z.string(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const AuditEntrySchema = z.object({
  id: z.union([z.number().int(), z.string()]),
  household_id: z.uuid(),
  actor_user_id: z.uuid().nullable(),
  action: z.string().min(1).max(LIMITS.action),
  entity_type: z.string().min(1).max(LIMITS.entityType),
  entity_id: z.string().max(LIMITS.entityId).nullable(),
  summary: z.string().max(LIMITS.summary).nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  created_at: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Input to public.log_audit. The actor is always the caller; it cannot be supplied. */
export const LogAuditInputSchema = z.object({
  household: z.uuid(),
  action: z.string().min(1).max(LIMITS.action),
  entityType: z.string().min(1).max(LIMITS.entityType),
  entityId: z.string().max(LIMITS.entityId).nullish(),
  summary: z.string().max(LIMITS.summary).nullish(),
  before: z.unknown().nullish(),
  after: z.unknown().nullish(),
});
export type LogAuditInput = z.infer<typeof LogAuditInputSchema>;
