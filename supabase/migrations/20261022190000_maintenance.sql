-- Maintenance reminders: house upkeep that repeats. Additive only.
-- maintenance_items: what needs doing and when it is next due.
-- maintenance_log: append-only history of each time it was done (users cannot update or delete rows).
-- Inserting a log row moves the item's last_done_on forward (never backwards) and, when the item has
-- an interval, sets next_due_on = last_done_on + interval_months months (Postgres month-end clamping:
-- 31 Jan + 1 month = 28/29 Feb). A one-off item (no interval) has its next_due_on cleared when done.

create table public.maintenance_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  area text check (area is null or length(area) <= 60),
  interval_months integer check (interval_months is null or interval_months between 1 and 120),
  season text check (season is null or season in ('spring', 'summer', 'autumn', 'winter')),
  last_done_on date,
  next_due_on date,
  notes text check (notes is null or length(notes) <= 1000),
  provider text check (provider is null or length(provider) <= 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_items_id_household_key unique (id, household_id)
);
create index maintenance_items_household_due_idx on public.maintenance_items (household_id, next_due_on);

create table public.maintenance_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  item_id uuid not null,
  done_on date not null,
  done_by uuid default auth.uid() references auth.users (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  -- Null means unknown, not zero.
  cost_gbp numeric(10, 2) check (cost_gbp is null or cost_gbp >= 0),
  created_at timestamptz not null default now(),
  -- Same-household FK: a log row can never point at another household's item.
  constraint maintenance_log_item_fk foreign key (item_id, household_id)
    references public.maintenance_items (id, household_id) on delete cascade
);
create index maintenance_log_item_idx on public.maintenance_log (item_id, done_on desc);
create index maintenance_log_household_idx on public.maintenance_log (household_id);

-- Integrity (BEFORE)
create trigger a_guard_owned_row before insert or update on public.maintenance_items
  for each row execute function private.guard_owned_row();

create function private.guard_maintenance_log() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  if (select auth.uid()) is not null then
    new.done_by := (select auth.uid());
  end if;
  return new;
end
$$;
create trigger a_guard_maintenance_log before insert on public.maintenance_log
  for each row execute function private.guard_maintenance_log();

-- Log insert -> update the item, and audit "done" (the item update itself is not audited separately).
create function private.apply_maintenance_log() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.maintenance_items;
begin
  perform set_config('ourhome.maintenance_log', '1', true);
  update public.maintenance_items i
  set last_done_on = greatest(i.last_done_on, new.done_on),
      next_due_on = case
        when i.interval_months is null then null
        else (greatest(i.last_done_on, new.done_on) + i.interval_months * interval '1 month')::date
      end
  where i.id = new.item_id and i.household_id = new.household_id
  returning * into v_item;
  perform set_config('ourhome.maintenance_log', '', true);

  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (new.household_id, (select auth.uid()), 'maintenance.done', 'maintenance', new.item_id::text, left(v_item.title, 500));
  return null;
end
$$;
create trigger apply_maintenance_log after insert on public.maintenance_log
  for each row execute function private.apply_maintenance_log();

-- Audit (AFTER). Summary is the title only: never notes, providers or costs.
create function private.audit_maintenance_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.maintenance_items;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('ourhome.maintenance_log', true), '') = '1' then
    return null;
  end if;
  v_action := case tg_op when 'INSERT' then 'maintenance.added' when 'DELETE' then 'maintenance.removed' else 'maintenance.updated' end;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'maintenance', v_row.id::text, left(v_row.title, 500));
  return null;
end
$$;
create trigger audit_maintenance_item after insert or update or delete on public.maintenance_items
  for each row execute function private.audit_maintenance_item();

revoke execute on function private.guard_maintenance_log(), private.apply_maintenance_log(),
  private.audit_maintenance_item() from public, anon, authenticated;

-- RLS and grants
alter table public.maintenance_items enable row level security;
alter table public.maintenance_items force row level security;
alter table public.maintenance_log enable row level security;
alter table public.maintenance_log force row level security;

revoke all on public.maintenance_items, public.maintenance_log from anon, authenticated;
grant select, insert, update, delete on public.maintenance_items to authenticated;
grant select, insert on public.maintenance_log to authenticated;

create policy maintenance_items_select on public.maintenance_items for select to authenticated
  using (private.is_household_member(household_id));
create policy maintenance_items_insert on public.maintenance_items for insert to authenticated
  with check (private.is_household_member(household_id));
create policy maintenance_items_update on public.maintenance_items for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy maintenance_items_delete on public.maintenance_items for delete to authenticated
  using (private.is_household_member(household_id));

create policy maintenance_log_select on public.maintenance_log for select to authenticated
  using (private.is_household_member(household_id));
create policy maintenance_log_insert on public.maintenance_log for insert to authenticated
  with check (private.is_household_member(household_id));
