-- Household records: renewals, bills, budgets, property facts, contacts. Additive only.
-- Columns, limits and enums mirror src/contracts/records.ts.

create table public.household_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category text not null check (category in (
    'property', 'purchase', 'property_document', 'mortgage', 'mortgage_option', 'banking',
    'insurance', 'electricity', 'gas', 'broadband', 'council_tax', 'water', 'factoring',
    'solar', 'maintenance', 'energy_efficiency', 'household_finance', 'contact', 'project'
  )),
  provider text check (provider is null or length(provider) <= 200),
  title text not null check (length(title) between 1 and 500),
  amount numeric(14, 2),
  unit text check (unit is null or unit in ('GBP', 'kWh')),
  amount_kind text check (amount_kind is null or amount_kind in ('budget', 'bill', 'estimate', 'snapshot', 'contract', 'proposal')),
  frequency text check (frequency is null or length(frequency) <= 100),
  start_date date,
  renewal_date date,
  end_date date,
  next_action text check (next_action is null or length(next_action) <= 500),
  reference_last4 text check (reference_last4 is null or char_length(reference_last4) = 4),
  status text check (status is null or length(status) <= 200),
  source text check (source is null or length(source) <= 500),
  verified boolean not null default false,
  as_of date,
  import_key text check (import_key is null or length(import_key) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_records_import_key_unique unique (household_id, import_key),
  constraint household_records_amount_needs_unit check (amount is null or unit is not null)
);
create index household_records_category_idx on public.household_records (household_id, category);
create index household_records_renewal_idx on public.household_records (household_id, renewal_date);

-- Integrity (BEFORE): reuse the shared created_by/household_id/updated_at guard.
create trigger a_guard_owned_row before insert or update on public.household_records
  for each row execute function private.guard_owned_row();

-- Audit (AFTER). Summary is the title only: never amounts or references.
create function private.audit_household_record() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.household_records;
begin
  if tg_op = 'INSERT' then
    v_action := 'record.created';
  elsif tg_op = 'DELETE' then
    v_action := 'record.deleted';
  elsif old.verified = false and new.verified = true then
    v_action := 'record.verified';
  else
    v_action := 'record.updated';
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (
    v_row.household_id, (select auth.uid()), v_action, 'record', v_row.id::text, left(v_row.title, 500),
    case when tg_op = 'INSERT' then null else to_jsonb(old) - 'amount' - 'reference_last4' - 'notes' end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) - 'amount' - 'reference_last4' - 'notes' end
  );
  return null;
end
$$;

create trigger audit_household_record after insert or update or delete on public.household_records
  for each row execute function private.audit_household_record();

revoke execute on function private.audit_household_record() from public, anon, authenticated;

-- RLS and grants
alter table public.household_records enable row level security;
alter table public.household_records force row level security;

revoke all on public.household_records from anon, authenticated;
grant select, insert, update, delete on public.household_records to authenticated;

create policy household_records_select on public.household_records for select to authenticated
  using (private.is_household_member(household_id));
create policy household_records_insert on public.household_records for insert to authenticated
  with check (private.is_household_member(household_id));
create policy household_records_update on public.household_records for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy household_records_delete on public.household_records for delete to authenticated
  using (private.is_household_member(household_id));
