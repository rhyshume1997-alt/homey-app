import type { FormAction } from "@/components/tasks/types";

export type EmergencyActions = {
  add: FormAction;
  update: FormAction;
  remove: FormAction;
};

/** What the seed and the "Not set yet" placeholder mean: shown muted so people know to fill it in. */
export const NOT_SET = "Not set yet";
