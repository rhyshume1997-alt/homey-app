/** State returned by form server actions. Messages are fixed, user-facing text only. */
export type FormState = { ok?: boolean; error?: string } | null;
export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export type MemberOption = { user_id: string; display_name: string };
