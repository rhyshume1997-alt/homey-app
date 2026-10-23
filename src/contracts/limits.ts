/**
 * Field limits shared by the zod schemas and the client forms. Kept free of zod so client
 * components (maxLength attributes) do not pull the validator into the browser bundle.
 */

/** Chores. Limits mirror the tasks migration (Phase 2). */
export const TASK_LIMITS = { title: 200, notes: 2000 } as const;

/** House snagging list. Limits mirror the snags migration (Phase 2). */
export const SNAG_LIMITS = { title: 200, location: 100, notes: 2000 } as const;
