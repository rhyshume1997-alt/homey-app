import { RowAction } from "@/components/tasks/RowAction";
import type { FormAction } from "@/components/tasks/types";

export function VerifyButton({ action, id }: { action: FormAction; id: string }) {
  return (
    <div className="mt-2">
      <RowAction action={action} id={id} label="Mark verified" />
    </div>
  );
}
