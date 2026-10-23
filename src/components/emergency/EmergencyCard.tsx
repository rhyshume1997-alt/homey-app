import { EMERGENCY_SECTION_TITLE, EMERGENCY_SECTIONS, type EmergencyItem, type EmergencySection } from "@/contracts/emergency";
import { AddEmergencyForm } from "./AddEmergencyForm";
import { EmergencyItemRow } from "./EmergencyItemRow";
import type { EmergencyActions } from "./types";

export function EmergencyCard({ items, actions }: { items: readonly EmergencyItem[]; actions: EmergencyActions }) {
  const bySection = (s: EmergencySection) => items.filter((i) => i.section === s);
  return (
    <div className="flex flex-col gap-4">
      {EMERGENCY_SECTIONS.map((section) => {
        const rows = bySection(section);
        const title = EMERGENCY_SECTION_TITLE[section];
        const id = `emergency-${section}`;
        return (
          <section key={section} aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <h2 id={id} className="text-2xl font-semibold">{title}</h2>
            {rows.length === 0 ? (
              <p className="text-lg text-muted">Nothing here yet.</p>
            ) : section === "step" ? (
              <ol className="flex flex-col gap-2">
                {rows.map((i, n) => <EmergencyItemRow key={i.id} item={i} actions={actions} step={n + 1} />)}
              </ol>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((i) => <EmergencyItemRow key={i.id} item={i} actions={actions} />)}
              </ul>
            )}
            <details className="rounded-md border border-border px-3 py-2">
              <summary className="flex min-h-[var(--touch-target)] cursor-pointer items-center text-base font-medium">
                Add to {title.toLowerCase()}
              </summary>
              <div className="pt-2">
                <AddEmergencyForm action={actions.add} defaultSection={section} />
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
