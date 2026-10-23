-- Meter readings. Additive only.
-- Only readings a person entered (or an email draft they confirmed) live here: usage is
-- derived on read from consecutive readings and is never estimated or gap-filled.

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  fuel text not null check (fuel in ('electricity', 'gas')),
  read_on date not null,
  value numeric(12, 3) not null check (value >= 0),
  unit text not null check (unit in ('kWh', 'm3')),
  source text not null default 'manual' check (source in ('manual', 'email')),
  source_message_hash text check (source_message_hash is null or length(source_message_hash) between 1 and 200),
  note text check (note is null or length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index meter_readings_household_hash_key
  on public.meter_readings (household_id, source_message_hash) where source_message_hash is not null;
create unique index meter_readings_household_fuel_date_key
  on public.meter_readings (household_id, fuel, read_on);
create index meter_readings_household_fuel_date_idx on public.meter_readings (household_id, fuel, read_on desc);

-- BEFORE: a reading cannot be dated after today (Europe/London) ---------------------------
create function private.guard_meter_reading() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.read_on is distinct from old.read_on)
     and new.read_on > (now() at time zone 'Europe/London')::date then
    raise exception 'meter reading cannot be in the future' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.meter_readings
  for each row execute function private.guard_owned_row();
create trigger b_guard_meter_reading before insert or update on public.meter_readings
  for each row execute function private.guard_meter_reading();

-- Audit (AFTER): fuel and date only, never the value. --------------------------------------
create function private.audit_meter_reading() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.meter_readings;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'meter_reading.added' when 'DELETE' then 'meter_reading.removed' else 'meter_reading.updated' end,
    'meter_reading', v_row.id::text, v_row.fuel || ' ' || v_row.read_on::text
  );
  return null;
end
$$;

create trigger audit_meter_reading after insert or update or delete on public.meter_readings
  for each row execute function private.audit_meter_reading();

revoke execute on function private.guard_meter_reading(), private.audit_meter_reading()
  from public, anon, authenticated;

-- RLS and grants ------------------------------------------------------------------------------
alter table public.meter_readings enable row level security;
alter table public.meter_readings force row level security;
revoke all on public.meter_readings from anon, authenticated;
grant select, insert, update, delete on public.meter_readings to authenticated;

create policy meter_readings_select on public.meter_readings for select to authenticated
  using (private.is_household_member(household_id));
create policy meter_readings_insert on public.meter_readings for insert to authenticated
  with check (private.is_household_member(household_id));
create policy meter_readings_update on public.meter_readings for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy meter_readings_delete on public.meter_readings for delete to authenticated
  using (private.is_household_member(household_id));
