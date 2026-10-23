import { FIELD, LABEL } from "@/components/tasks/styles";

export type RoomOption = { id: string; name: string };

/**
 * Optional room select for task and snag forms.
 * With no rooms list (a page that has not loaded rooms) it renders a hidden input that keeps the
 * current value, so editing never silently clears an existing room link.
 */
export function RoomPicker({ rooms, value }: { rooms?: readonly RoomOption[]; value: string | null | undefined }) {
  if (!rooms) return value ? <input type="hidden" name="room_id" value={value} /> : null;
  if (rooms.length === 0) return null;
  return (
    <label className={LABEL}>
      Room (optional)
      <select name="room_id" defaultValue={value ?? ""} className={FIELD}>
        <option value="">No room</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </label>
  );
}
