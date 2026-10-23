-- Appliances and warranties (D1). Additive only: one new table.
-- Only what a person (or the email import, via the same validated save path) entered is stored.
-- source_message_hash is a hash of the source message id, never the email itself.
-- serial_last4 holds the last four characters only, never a full serial number.

create table public.appliances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  name text not null check (length(name) between 1 and 80),
  make text check (make is null or length(make) <= 60),
  model text check (model is null or length(model) <= 60),
  serial_last4 text check (serial_last4 is null or length(serial_last4) = 4),
  purchase_date date,
  warranty_end date,
  source text not null default 'manual' check (source in ('manual', 'email')),
  source_message_hash text check (source_message_hash is null or length(source_message_hash) between 8 and 128),
  manual_document_id uuid references public.documents (id) on delete set null,
  receipt_document_id uuid references public.documents (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index appliances_household_source_hash_key
  on public.appliances (household_id, source_message_hash) where source_message_hash is not null;
create index appliances_household_warranty_idx on public.appliances (household_id, warranty_end);
create index appliances_room_idx on public.appliances (room_id) where room_id is not null;

-- Room and documents must belong to the same household.
create function private.guard_appliance_links() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.household_id = new.household_id
  ) then
    raise exception 'room not in this household' using errcode = '42501';
  end if;
  if new.manual_document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.manual_document_id and d.household_id = new.household_id
  ) then
    raise exception 'document not in this household' using errcode = '42501';
  end if;
  if new.receipt_document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.receipt_document_id and d.household_id = new.household_id
  ) then
    raise exception 'document not in this household' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.appliances
  for each row execute function private.guard_owned_row();
create trigger d_guard_appliance_links
  before insert or update of room_id, manual_document_id, receipt_document_id, household_id on public.appliances
  for each row execute function private.guard_appliance_links();

-- Audit (AFTER). The summary is the appliance name only. ----------------------------------
create function private.audit_appliance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.appliances;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'appliance.created' when 'DELETE' then 'appliance.deleted' else 'appliance.updated' end,
    'appliance', v_row.id::text, left(v_row.name, 500)
  );
  return null;
end
$$;
create trigger audit_appliance after insert or update or delete on public.appliances
  for each row execute function private.audit_appliance();

revoke execute on function private.guard_appliance_links(), private.audit_appliance()
  from public, anon, authenticated;

-- RLS and grants ---------------------------------------------------------------------------
alter table public.appliances enable row level security;
alter table public.appliances force row level security;
revoke all on public.appliances from anon, authenticated;
grant select, insert, update, delete on public.appliances to authenticated;

create policy appliances_select on public.appliances for select to authenticated
  using (private.is_household_member(household_id));
create policy appliances_insert on public.appliances for insert to authenticated
  with check (private.is_household_member(household_id));
create policy appliances_update on public.appliances for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy appliances_delete on public.appliances for delete to authenticated
  using (private.is_household_member(household_id));
