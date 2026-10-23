-- Our Home D18: the 11 additive migrations from supabase/migrations/20261024*, in order, then recorded
-- in the migration history. One-off helper for the Supabase SQL editor: paste all of it and Run once.
-- All or nothing: if any statement fails, nothing is changed.
begin;

-- ===== 20261024090000_rooms.sql =====
-- Rooms (D18). Additive only: a new table, nullable room_id on tasks and snags, and the
-- household's ten rooms seeded for every existing household. Snags whose free-text location
-- exactly matches a room name (case-insensitive) are linked to it; nothing else is changed.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  sort_order int not null default 0 check (sort_order between 0 and 1000),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rooms_household_name_key on public.rooms (household_id, lower(name));

alter table public.tasks add column room_id uuid references public.rooms (id) on delete set null;
alter table public.snags add column room_id uuid references public.rooms (id) on delete set null;
create index tasks_room_idx on public.tasks (room_id) where room_id is not null;
create index snags_room_idx on public.snags (room_id) where room_id is not null;

-- A task or snag may only point at a room in its own household.
create function private.guard_room_link() returns trigger
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
create trigger d_guard_room_link before insert or update of room_id, household_id on public.tasks
  for each row execute function private.guard_room_link();
create trigger d_guard_room_link before insert or update of room_id, household_id on public.snags
  for each row execute function private.guard_room_link();

create trigger a_guard_owned_row before insert or update on public.rooms
  for each row execute function private.guard_owned_row();

create function private.audit_room() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.rooms;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'room.created' when 'DELETE' then 'room.deleted' else 'room.updated' end,
    'room', v_row.id::text, left(v_row.name, 500)
  );
  return null;
end
$$;
create trigger audit_room after insert or update or delete on public.rooms
  for each row execute function private.audit_room();

revoke execute on function private.guard_room_link(), private.audit_room() from public, anon, authenticated;

alter table public.rooms enable row level security;
alter table public.rooms force row level security;
revoke all on public.rooms from anon, authenticated;
grant select, insert, update, delete on public.rooms to authenticated;

create policy rooms_select on public.rooms for select to authenticated
  using (private.is_household_member(household_id));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (private.is_household_member(household_id));
create policy rooms_update on public.rooms for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy rooms_delete on public.rooms for delete to authenticated
  using (private.is_household_member(household_id));

-- Seed Alex's rooms (D18) for every household that has none yet. No audit actor: system write.
insert into public.rooms (household_id, name, sort_order)
select h.id, r.name, r.ord
from public.households h
cross join (values
  ('Living room', 10), ('WC', 20), ('Kitchen', 30), ('Office bedroom', 40), ('Main bedroom', 50),
  ('Spare bedroom', 60), ('Bathroom', 70), ('Understairs cupboard', 80),
  ('Washing machine cupboard', 90), ('Laundry cupboard', 100)
) as r (name, ord)
where not exists (select 1 from public.rooms x where x.household_id = h.id);

update public.snags s set room_id = r.id
from public.rooms r
where s.room_id is null and r.household_id = s.household_id
  and s.location is not null and lower(trim(s.location)) = lower(r.name);

-- Recurring tasks keep their room when the next occurrence is created (review finding F1).
-- Same as 20261023100000_task_recurrence_yearly, plus room_id.
create or replace function private.spawn_next_task() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_next uuid;
  v_base date;
begin
  -- next_task_id is read-only to clients; only the spawn path below (or system writes) sets it.
  if v_uid is not null then
    new.next_task_id := case when tg_op = 'INSERT' then null else old.next_task_id end;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'open' and new.status = 'done'
     and new.recurrence in ('daily', 'weekly', 'monthly', 'yearly')
     and old.next_task_id is null
     and new.next_task_id is null then
    v_base := coalesce(new.due_date, (now() at time zone 'Europe/London')::date);
    insert into public.tasks (household_id, title, notes, assignee_user_id, recurrence, due_date, created_by, room_id)
    values (
      new.household_id, new.title, new.notes,
      -- Drop an assignee who has left the household, or guard_task would block completing this task.
      case when exists (
        select 1 from public.household_members m
        where m.household_id = new.household_id and m.user_id = new.assignee_user_id
      ) then new.assignee_user_id end,
      new.recurrence,
      (v_base + case new.recurrence
        when 'daily' then interval '1 day'
        when 'weekly' then interval '7 days'
        when 'yearly' then interval '1 year'
        else interval '1 month'
      end)::date,
      coalesce(v_uid, new.completed_by),
      new.room_id
    )
    returning id into v_next;
    new.next_task_id := v_next;
  end if;
  return new;
end
$$;
revoke execute on function private.spawn_next_task() from public, anon, authenticated;

-- ===== 20261024100000_ai_digests.sql =====
-- Homey's daily AI summary (D18), cached per member per day. Additive only.
-- Rows are written by the server acting as the signed-in member (RLS applies); they are never
-- edited or deleted by members. The body holds only the summary text and item keys.

create table public.ai_digests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  trigger text not null check (trigger in ('sign_in', 'first_open', 'refresh')),
  model text not null check (model ~ '^claude-[a-z0-9.-]{1,80}$'),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 4096),
  created_at timestamptz not null default now(),
  constraint ai_digests_once_per_input unique (household_id, user_id, day, input_hash)
);
create index ai_digests_household_day_idx on public.ai_digests (household_id, day);

-- created_at is always the server time, so the newest row really is the newest.
create function private.guard_ai_digest() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end
$$;
create trigger a_guard_ai_digest before insert on public.ai_digests
  for each row execute function private.guard_ai_digest();
revoke execute on function private.guard_ai_digest() from public, anon, authenticated;

alter table public.ai_digests enable row level security;
alter table public.ai_digests force row level security;
revoke all on public.ai_digests from anon, authenticated;
grant select, insert on public.ai_digests to authenticated;

-- Members see their household's rows (needed to count the household's daily generations).
create policy ai_digests_select on public.ai_digests for select to authenticated
  using (private.is_household_member(household_id));
-- A member writes only their own row, in their own household, for a day close to today.
create policy ai_digests_insert on public.ai_digests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
    and day between (now() at time zone 'UTC')::date - 1 and (now() at time zone 'UTC')::date + 1
  );
-- No update or delete policy and no grant: rows are immutable for members.

-- ===== 20261024101000_kudos.sql =====
-- Kudos: in-app thank-yous between the two household members. Additive only.
-- Never emailed. from_user is always the caller (trigger); rows are immutable.

create table public.kudos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  -- No FK: audit_log is append-only (TRUNCATE guard); the trigger checks the row is in this household.
  audit_id bigint,
  message text not null check (length(message) between 1 and 200),
  created_at timestamptz not null default now()
);
create index kudos_household_created_idx on public.kudos (household_id, created_at desc);
create index kudos_to_user_created_idx on public.kudos (to_user, created_at desc);
-- One thank-you per sender per logged action.
create unique index kudos_from_audit_key on public.kudos (from_user, audit_id) where audit_id is not null;

create function private.guard_kudos() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.created_at := now(); -- server time only (ordering and "recent" checks rely on it)
  -- Never trust input for the sender. Only trusted server roles (no JWT) may keep a supplied value.
  if v_uid is not null then
    new.from_user := v_uid;
  elsif new.from_user is null then
    raise exception 'kudos sender required';
  end if;
  if new.to_user = new.from_user then
    raise exception 'cannot thank yourself';
  end if;
  if not exists (
    select 1 from public.household_members m where m.household_id = new.household_id and m.user_id = new.from_user
  ) or not exists (
    select 1 from public.household_members m where m.household_id = new.household_id and m.user_id = new.to_user
  ) then
    raise exception 'both people must be in the household';
  end if;
  if new.audit_id is not null and not exists (
    select 1 from public.audit_log a where a.id = new.audit_id and a.household_id = new.household_id
  ) then
    raise exception 'audit entry is not in this household';
  end if;
  return new;
end
$$;

create trigger guard_kudos before insert on public.kudos
  for each row execute function private.guard_kudos();
revoke execute on function private.guard_kudos() from public, anon, authenticated;

alter table public.kudos enable row level security;
alter table public.kudos force row level security;

revoke all on public.kudos from anon, authenticated;
grant select, insert on public.kudos to authenticated;

create policy kudos_select on public.kudos for select to authenticated
  using (private.is_household_member(household_id));
create policy kudos_insert on public.kudos for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and from_user = (select auth.uid())
    and to_user <> (select auth.uid())
    and exists (
      select 1 from public.household_members m
      where m.household_id = kudos.household_id and m.user_id = kudos.to_user
    )
  );

-- ===== 20261024111000_wishlist.sql =====
-- Things to get (wishlist), D18. Additive only: one new table.
-- Nothing here buys anything. A link is just a link the person typed in; price_estimate is a rough guess.

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  title text not null check (length(title) between 1 and 120),
  price_estimate numeric(10, 2) check (price_estimate is null or price_estimate >= 0),
  url text check (
    url is null or (
      length(url) <= 2048
      and url ~ '^https://'
      and url !~ '[[:space:][:cntrl:]]'
      and url !~ '^https://[^/?#]*@'
    )
  ),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'idea' check (status in ('idea', 'saving', 'bought')),
  photo_document_id uuid references public.documents (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  bought_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wishlist_items_household_status_idx on public.wishlist_items (household_id, status);
create index wishlist_items_room_idx on public.wishlist_items (room_id) where room_id is not null;
create index wishlist_items_photo_idx on public.wishlist_items (photo_document_id) where photo_document_id is not null;

-- bought_at is set only by this trigger, when status becomes bought; clients cannot spoof it.
create function private.guard_wishlist_item() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.bought_at := case when new.status = 'bought' then now() end;
  elsif new.status is distinct from old.status then
    new.bought_at := case when new.status = 'bought' then now() end;
  else
    new.bought_at := old.bought_at;
  end if;
  return new;
end
$$;

-- A wishlist photo may only be a document in the same household.
create function private.guard_wishlist_photo() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.photo_document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.photo_document_id and d.household_id = new.household_id
  ) then
    raise exception 'document not in this household' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.wishlist_items
  for each row execute function private.guard_owned_row();
create trigger b_guard_wishlist_item before insert or update on public.wishlist_items
  for each row execute function private.guard_wishlist_item();
create trigger d_guard_room_link before insert or update of room_id, household_id on public.wishlist_items
  for each row execute function private.guard_room_link();
create trigger d_guard_wishlist_photo before insert or update of photo_document_id, household_id on public.wishlist_items
  for each row execute function private.guard_wishlist_photo();

-- Audit: title only. No price, no URL.
create function private.audit_wishlist_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.wishlist_items;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_action := case
    when tg_op = 'INSERT' then 'wishlist.added'
    when tg_op = 'DELETE' then 'wishlist.removed'
    when old.status is distinct from new.status and new.status = 'bought' then 'wishlist.bought'
    else 'wishlist.updated'
  end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'wishlist_item', v_row.id::text, left(v_row.title, 500));
  return null;
end
$$;
create trigger audit_wishlist_item after insert or update or delete on public.wishlist_items
  for each row execute function private.audit_wishlist_item();

revoke execute on function private.guard_wishlist_item(), private.guard_wishlist_photo(), private.audit_wishlist_item()
  from public, anon, authenticated;

alter table public.wishlist_items enable row level security;
alter table public.wishlist_items force row level security;
revoke all on public.wishlist_items from anon, authenticated;
grant select, insert, update, delete on public.wishlist_items to authenticated;

create policy wishlist_items_select on public.wishlist_items for select to authenticated
  using (private.is_household_member(household_id));
create policy wishlist_items_insert on public.wishlist_items for insert to authenticated
  with check (private.is_household_member(household_id));
create policy wishlist_items_update on public.wishlist_items for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy wishlist_items_delete on public.wishlist_items for delete to authenticated
  using (private.is_household_member(household_id));

-- ===== 20261024112000_checklist.sql =====
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

-- ===== 20261024113000_emergency.sql =====
-- Emergency card (D18). Additive only: one new table, seeded for every existing household.
-- Values are only what a household types in; the seed holds placeholders ("Not set yet"),
-- except the national gas emergency number, which is public information.

create table public.emergency_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  section text not null check (section in ('location', 'step', 'number')),
  label text not null check (length(label) between 1 and 80),
  detail text not null check (length(detail) between 1 and 300),
  sort_order int not null default 0 check (sort_order between 0 and 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index emergency_items_household_section_idx on public.emergency_items (household_id, section, sort_order);

-- Integrity (BEFORE): shared owner/household/updated_at guard.
create trigger a_guard_owned_row before insert or update on public.emergency_items
  for each row execute function private.guard_owned_row();

-- Audit (AFTER). Summaries carry the label only, never the detail (numbers, codes).
create function private.audit_emergency_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.emergency_items;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'emergency.added' when 'DELETE' then 'emergency.removed' else 'emergency.updated' end,
    'emergency_item', v_row.id::text, left(v_row.label, 500)
  );
  return null;
end
$$;
create trigger audit_emergency_item after insert or update or delete on public.emergency_items
  for each row execute function private.audit_emergency_item();

revoke execute on function private.audit_emergency_item() from public, anon, authenticated;

-- RLS and grants -------------------------------------------------------------------------
alter table public.emergency_items enable row level security;
alter table public.emergency_items force row level security;
revoke all on public.emergency_items from anon, authenticated;
grant select, insert, update, delete on public.emergency_items to authenticated;

create policy emergency_items_select on public.emergency_items for select to authenticated
  using (private.is_household_member(household_id));
create policy emergency_items_insert on public.emergency_items for insert to authenticated
  with check (private.is_household_member(household_id));
create policy emergency_items_update on public.emergency_items for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy emergency_items_delete on public.emergency_items for delete to authenticated
  using (private.is_household_member(household_id));

-- Seed the card for every household that has no emergency items yet. System write: no actor.
insert into public.emergency_items (household_id, section, label, detail, sort_order)
select h.id, s.section, s.label, s.detail, s.ord
from public.households h
cross join (values
  ('location', 'Stopcock', 'Not set yet', 10),
  ('location', 'Fuse box', 'Not set yet', 20),
  ('location', 'Gas meter', 'Not set yet', 30),
  ('location', 'Electric meter', 'Not set yet', 40),
  ('step', 'Boiler reset', 'Not set yet', 10),
  ('number', 'Gas emergency', '0800 111 999', 10),
  ('number', 'Water supplier', 'Not set yet', 20),
  ('number', 'Boiler engineer', 'Not set yet', 30)
) as s (section, label, detail, ord)
where not exists (select 1 from public.emergency_items x where x.household_id = h.id);

-- ===== 20261024114000_wifi.sql =====
-- Guest wifi. Additive only. The password is only ever stored as application-layer ciphertext
-- (AES-256-GCM, AAD "wifi:"+household_id); the audit summary carries the network name only.

create table public.wifi_networks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ssid text not null check (length(ssid) between 1 and 32),
  security text not null default 'WPA' check (security in ('WPA', 'WEP', 'nopass')),
  password_ciphertext text check (password_ciphertext is null or length(password_ciphertext) between 1 and 1000),
  hidden boolean not null default false,
  is_guest boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((security = 'nopass') = (password_ciphertext is null))
);
create index wifi_networks_household_idx on public.wifi_networks (household_id);

create trigger a_guard_owned_row before insert or update on public.wifi_networks
  for each row execute function private.guard_owned_row();

create function private.audit_wifi_network() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.wifi_networks;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_action := case tg_op when 'INSERT' then 'wifi.added' when 'DELETE' then 'wifi.removed' else 'wifi.updated' end;
  -- Summary is the network name only: never the password or ciphertext.
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'wifi_network', v_row.id::text, left(v_row.ssid, 100));
  return null;
end
$$;

create trigger audit_wifi_network after insert or update or delete on public.wifi_networks
  for each row execute function private.audit_wifi_network();

revoke execute on function private.audit_wifi_network() from public, anon, authenticated;

alter table public.wifi_networks enable row level security;
alter table public.wifi_networks force row level security;

revoke all on public.wifi_networks from anon, authenticated;
grant select, insert, update, delete on public.wifi_networks to authenticated;

create policy wifi_networks_select on public.wifi_networks for select to authenticated
  using (private.is_household_member(household_id));
create policy wifi_networks_insert on public.wifi_networks for insert to authenticated
  with check (private.is_household_member(household_id));
create policy wifi_networks_update on public.wifi_networks for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy wifi_networks_delete on public.wifi_networks for delete to authenticated
  using (private.is_household_member(household_id));

-- ===== 20261024115000_household_events.sql =====
-- Shared household calendar events (C6). Additive only.
create table public.household_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  starts_on date not null,
  starts_at time,
  ends_on date,
  all_day boolean not null default true,
  room_id uuid references public.rooms (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_events_end_after_start check (ends_on is null or ends_on >= starts_on),
  constraint household_events_time_not_all_day check (starts_at is null or not all_day)
);
create index household_events_household_date_idx on public.household_events (household_id, starts_on);

create trigger a_guard_owned_row before insert or update on public.household_events
  for each row execute function private.guard_owned_row();
create trigger d_guard_room_link before insert or update of room_id, household_id on public.household_events
  for each row execute function private.guard_room_link();

create function private.audit_household_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.household_events;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'event.created' when 'DELETE' then 'event.deleted' else 'event.updated' end,
    'household_event', v_row.id::text, left(v_row.title, 500)
  );
  return null;
end
$$;
create trigger audit_household_event after insert or update or delete on public.household_events
  for each row execute function private.audit_household_event();
revoke execute on function private.audit_household_event() from public, anon, authenticated;

alter table public.household_events enable row level security;
alter table public.household_events force row level security;
revoke all on public.household_events from anon, authenticated;
grant select, insert, update, delete on public.household_events to authenticated;

create policy household_events_select on public.household_events for select to authenticated
  using (private.is_household_member(household_id));
create policy household_events_insert on public.household_events for insert to authenticated
  with check (private.is_household_member(household_id));
create policy household_events_update on public.household_events for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy household_events_delete on public.household_events for delete to authenticated
  using (private.is_household_member(household_id));

-- ===== 20261024120000_appliances.sql =====
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

-- ===== 20261024121000_meter_readings.sql =====
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

-- ===== 20261024122000_meals.sql =====
-- Meal planner (D5). Additive only: two new tables.
-- Ingredient stock is never inferred here: "in / low / need" is derived at read time from
-- what people entered on the supplies list.

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  planned_on date not null,
  slot text not null default 'dinner' check (slot in ('lunch', 'dinner')),
  title text not null check (length(title) between 1 and 80),
  notes text check (notes is null or length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meals_household_date_idx on public.meals (household_id, planned_on);

create table public.meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  meal_id uuid not null references public.meals (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  quantity text check (quantity is null or length(quantity) <= 30),
  unit_price_estimate numeric(8,2) check (unit_price_estimate is null or unit_price_estimate >= 0),
  supply_id uuid references public.supplies (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_ingredients_meal_idx on public.meal_ingredients (meal_id);
create index meal_ingredients_household_idx on public.meal_ingredients (household_id);
create index meal_ingredients_supply_idx on public.meal_ingredients (supply_id) where supply_id is not null;

-- An ingredient may only point at a meal and a supply in its own household.
create function private.guard_meal_ingredient_links() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.meals m where m.id = new.meal_id and m.household_id = new.household_id
  ) then
    raise exception 'meal not in this household' using errcode = '42501';
  end if;
  if new.supply_id is not null and not exists (
    select 1 from public.supplies s where s.id = new.supply_id and s.household_id = new.household_id
  ) then
    raise exception 'supply not in this household' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.meals
  for each row execute function private.guard_owned_row();
create trigger a_guard_owned_row before insert or update on public.meal_ingredients
  for each row execute function private.guard_owned_row();
create trigger d_guard_meal_ingredient_links before insert or update of meal_id, supply_id, household_id
  on public.meal_ingredients
  for each row execute function private.guard_meal_ingredient_links();

-- Audit (AFTER). The summary carries the meal title only: no prices, no ingredient detail. --
create function private.audit_meal() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.meals;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'meal.created' when 'DELETE' then 'meal.deleted' else 'meal.updated' end,
    'meal', v_row.id::text, left(v_row.title, 500)
  );
  return null;
end
$$;
create trigger audit_meal after insert or update or delete on public.meals
  for each row execute function private.audit_meal();

revoke execute on function private.guard_meal_ingredient_links(), private.audit_meal()
  from public, anon, authenticated;

-- RLS and grants -------------------------------------------------------------------------
alter table public.meals enable row level security;
alter table public.meals force row level security;
alter table public.meal_ingredients enable row level security;
alter table public.meal_ingredients force row level security;

revoke all on public.meals, public.meal_ingredients from anon, authenticated;
grant select, insert, update, delete on public.meals, public.meal_ingredients to authenticated;

create policy meals_select on public.meals for select to authenticated
  using (private.is_household_member(household_id));
create policy meals_insert on public.meals for insert to authenticated
  with check (private.is_household_member(household_id));
create policy meals_update on public.meals for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy meals_delete on public.meals for delete to authenticated
  using (private.is_household_member(household_id));

create policy meal_ingredients_select on public.meal_ingredients for select to authenticated
  using (private.is_household_member(household_id));
create policy meal_ingredients_insert on public.meal_ingredients for insert to authenticated
  with check (private.is_household_member(household_id));
create policy meal_ingredients_update on public.meal_ingredients for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy meal_ingredients_delete on public.meal_ingredients for delete to authenticated
  using (private.is_household_member(household_id));

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261024090000', 'rooms'),  ('20261024100000', 'ai_digests'),  ('20261024101000', 'kudos'),  ('20261024111000', 'wishlist'),  ('20261024112000', 'checklist'),  ('20261024113000', 'emergency'),  ('20261024114000', 'wifi'),  ('20261024115000', 'household_events'),  ('20261024120000', 'appliances'),  ('20261024121000', 'meter_readings'),  ('20261024122000', 'meals')
on conflict do nothing;
commit;
