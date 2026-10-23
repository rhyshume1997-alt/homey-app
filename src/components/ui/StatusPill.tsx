import { STATUS_LABEL, countLights, type Light } from "@/components/status";

const PILL: Record<Light, string> = {
  red: "border-danger-border bg-danger-bg text-danger-fg",
  amber: "border-warning-border bg-warning-bg text-warning-fg",
  green: "border-success-border bg-success-bg text-success-fg",
};
const DOT: Record<Light, string> = { red: "bg-danger-fg", amber: "bg-warning-fg", green: "bg-success-fg" };

/** Traffic-light pill: colour plus a dot plus a word, never colour alone. */
export function StatusPill({ light, label }: { light: Light; label?: string }) {
  return (
    <span
      data-light={light}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${PILL[light]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[light]}`} />
      {label ?? STATUS_LABEL[light]}
    </span>
  );
}

/** "● 2 overdue ● 3 due soon ● 9 on track" summary line. */
export function LightSummary({ lights }: { lights: readonly Light[] }) {
  const c = countLights(lights);
  const parts: [Light, string][] = [
    ["red", `${c.red} overdue`],
    ["amber", `${c.amber} due soon`],
    ["green", `${c.green} on track`],
  ];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium" data-testid="light-summary">
      {parts.map(([l, text]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[l]}`} />
          {text}
        </span>
      ))}
    </p>
  );
}
