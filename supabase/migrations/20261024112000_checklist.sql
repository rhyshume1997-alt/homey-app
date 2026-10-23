-- Seasonal checklist (D18). Additive only: a new table plus default items for every existing
-- household. Nothing is marked done: last_done_on stays empty until a person marks it.

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  season text not null default 'any' check (season in ('autumn', 'winter', 'spring', 'summer', 'any')),
  frequency text not null check (frequency in ('monthly', 'yearly')),
  month smallint check (month is null or month between 1 and 12),
  room_id uuid references public.rooms (id) on delete set null,
  last_done_on date,
  next_due_on date,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequency = 'yearly' or month is null)
);
create unique index checklist_items_household_title_key on public.checklist_items (household_id, lower(title));
create index checklist_items_due_idx on public.checklist_items (household_id, next_due_on);
create index checklist_items_room_idx on public.checklist_items (room_id) where room_id is not null;

-- next_due_on is always computed here, never trusted from the client.
--   monthly: a month after last_done_on; never done: the 1st of this month.
--   yearly with a month: the 1st of that month, at least 6 months after last_done_on;
--     never done: the 1st of that month this year.
--   yearly without a month: a year after last_done_on; never done: no date.
create function private.guard_checklist_item() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base date;
begin
  if tg_op = 'UPDATE'
     and new.frequency is not distinct from old.frequency
     and new.month is not distinct from old.month
     and new.last_done_on is not distinct from old.last_done_on then
    new.next_due_on := old.next_due_on;
    return new;
  end if;
  if new.frequency = 'monthly' then
    new.next_due_on := case
      when new.last_done_on is null then date_trunc('month', current_date)::date
      else (new.last_done_on + interval '1 month')::date end;
  elsif new.month is not null then
    if new.last_done_on is null then
      new.next_due_on := make_date(extract(year from current_date)::int, new.month, 1);
    else
      v_base := (new.last_done_on + interval '6 months')::date;
      new.next_due_on := make_date(extract(year from v_base)::int, new.month, 1);
      if new.next_due_on <= v_base then
        new.next_due_on := (new.next_due_on + interval '1 year')::date;
      end if;
    end if;
  else
    new.next_due_on := case when new.last_done_on is null then null
      else (new.last_done_on + interval '1 year')::date end;
  end if;
  return new;
end
$$;

-- An item may only point at a room in its own household.
create function private.guard_checklist_room() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.household_id = new.household_id
  ) then
    raise exception 'room not in this household' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.checklist_items
  for each row execute function private.guard_owned_row();
create trigger b_guard_checklist_item before insert or update on public.checklist_items
  for each row execute function private.guard_checklist_item();
create trigger d_guard_checklist_room before insert or update of room_id, household_id on public.checklist_items
  for each row execute function private.guard_checklist_room();

-- Audit (AFTER). Summary is the title only.
create function private.audit_checklist_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.checklist_items;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'INSERT' then
    v_action := 'checklist.added';
  elsif tg_op = 'DELETE' then
    v_action := 'checklist.removed';
  elsif new.last_done_on is distinct from old.last_done_on and new.last_done_on is not null then
    v_action := 'checklist.done';
  else
    v_action := 'checklist.updated';
  end if;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'checklist_item', v_row.id::text, left(v_row.title, 500));
  return null;
end
$$;
create trigger audit_checklist_item after insert or update or delete on public.checklist_items
  for each row execute function private.audit_checklist_item();

revoke execute on function private.guard_checklist_item(), private.guard_checklist_room(),
  private.audit_checklist_item() from public, anon, authenticated;

alter table public.checklist_items enable row level security;
alter table public.checklist_items force row level security;
revoke all on public.checklist_items from anon, authenticated;
grant select, insert, update, delete on public.checklist_items to authenticated;

create policy checklist_items_select on public.checklist_items for select to authenticated
  using (private.is_household_member(household_id));
create policy checklist_items_insert on public.checklist_items for insert to authenticated
  with check (private.is_household_member(household_id));
create policy checklist_items_update on public.checklist_items for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy checklist_items_delete on public.checklist_items for delete to authenticated
  using (private.is_household_member(household_id));

-- Default items for every existing household. System write: no audit actor.
insert into public.checklist_items (household_id, title, season, frequency, month, notes)
select h.id, d.title, d.season, d.frequency, d.month, d.notes
from public.households h
cross join (values
  ('Bleed radiators', 'autumn', 'yearly', 10::smallint, null::text),
  ('Clear gutters', 'autumn', 'yearly', 11::smallint, null),
  ('Test smoke alarms', 'any', 'monthly', null::smallint, null),
  ('Boiler service', 'any', 'yearly', 2::smallint, 'Covered by task: the yearly boiler service task already tracks this.'),
  ('Check stopcock turns', 'spring', 'yearly', 3::smallint, null),
  ('Clean extractor fan filters', 'any', 'yearly', null::smallint, null),
  ('Check loft insulation', 'autumn', 'yearly', 9::smallint, null)
) as d (title, season, frequency, month, notes)
where not exists (
  select 1 from public.checklist_items c where c.household_id = h.id and lower(c.title) = lower(d.title)
);
