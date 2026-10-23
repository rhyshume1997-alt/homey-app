import { formatDate, type DatePrefs } from "@/components/dates";
import { CATEGORY_LABEL } from "@/components/money/format";
import type { HouseholdRecord } from "@/contracts/records";
import { Empty, Section } from "./RecordCard";
import type { ProviderGroup } from "./model";

export function ContactsView({
  data,
  datePrefs,
}: {
  data: { contacts: readonly HouseholdRecord[]; providers: readonly ProviderGroup[] } | null;
  datePrefs?: DatePrefs;
}) {
  const contacts = [...(data?.contacts ?? [])].sort((a, b) => (a.provider ?? "~").localeCompare(b.provider ?? "~"));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Contacts</h1>
      <Section title="People and companies">
        {data === null ? (
          <Empty failed />
        ) : contacts.length === 0 ? (
          <Empty />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {contacts.map((r) => (
              <li key={r.id} data-testid="contact-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
                <p className="break-words font-medium">{r.provider ?? "Unknown"}</p>
                <p className="mt-1 break-words">{r.title}</p>
                <p className="mt-1 text-muted">Since {r.start_date ? formatDate(r.start_date, datePrefs) : "Unknown"}</p>
                {r.next_action && <p className="mt-1 break-words">Next: {r.next_action}</p>}
                {r.reference_last4 && <p className="mt-1 text-muted">ref ••{r.reference_last4}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Companies we deal with" note="Read-only, taken from other records.">
        {data === null ? (
          <Empty failed />
        ) : data.providers.length === 0 ? (
          <Empty />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.providers.map((p) => (
              <li key={p.provider} data-testid="provider-row" className="rounded-md bg-surface-muted px-3 py-3 text-sm">
                <p className="break-words font-medium">{p.provider}</p>
                <p className="mt-1 text-muted">
                  {p.categories.map((c) => CATEGORY_LABEL[c]).join(", ")} · {p.count} {p.count === 1 ? "record" : "records"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
