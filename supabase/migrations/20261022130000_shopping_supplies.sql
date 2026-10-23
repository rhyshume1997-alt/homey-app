-- Shopping list and household supplies. Additive only.
-- Supply status is only ever what a person entered: nothing here estimates stock.

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  quantity text check (quantity is null or length(quantity) <= 40),
  shop text check (shop is null or length(shop) <= 60),
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopping_items_household_done_idx on public.shopping_items (household_id, done);

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  location text check (location is null or length(location) <= 60),
  status text not null default 'ok' check (status in ('ok', 'low', 'out')),
  notes text check (notes is null or length(notes) <= 300),
  last_checked_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplies_household_name_key on public.supplies (household_id, lower(name));
create index supplies_household_status_idx on public.supplies (household_id, status);

-- BEFORE triggers (a_ runs first: shared owner/household/updated_at guard) -------------
create function private.guard_shopping_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' or new.done is distinct from old.done then
    if new.done then
      new.done_at := now();
      new.done_by := v_uid;
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  elsif v_uid is not null then
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end
$$;

create function private.guard_supply() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.last_checked_at := null; -- only a status change counts as a check
  elsif new.status is distinct from old.status then
    new.last_checked_at := now();
  else
    new.last_checked_at := old.last_checked_at;
  end if;
  return new;
end
$$;

create trigger a_guard_owned_row before insert or update on public.shopping_items
  for each row execute function private.guard_owned_row();
create trigger b_guard_shopping_item before insert or update on public.shopping_items
  for each row execute function private.guard_shopping_item();
create trigger a_guard_owned_row before insert or update on public.supplies
  for each row execute function private.guard_owned_row();
create trigger b_guard_supply before insert or update on public.supplies
  for each row execute function private.guard_supply();

-- Audit (AFTER). Summaries carry the title/name and the new status only. ---------------
create function private.audit_shopping_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.shopping_items;
begin
  if tg_op = 'INSERT' then
    v_action := 'shopping.added';
  elsif tg_op = 'DELETE' then
    v_action := 'shopping.removed';
  elsif old.done = false and new.done = true then
    v_action := 'shopping.bought';
  else
    v_action := 'shopping.updated';
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'shopping_item', v_row.id::text, left(v_row.title, 500));
  return null;
end
$$;

create function private.audit_supply() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.supplies;
  v_summary text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_summary := left(v_row.name, 400);
  if tg_op = 'INSERT' then
    v_action := 'supply.added';
  elsif tg_op = 'DELETE' then
    v_action := 'supply.removed';
  elsif new.status is distinct from old.status then
    v_action := 'supply.status_changed';
    v_summary := v_summary || ': ' || new.status;
  else
    v_action := 'supply.updated';
  end if;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'supply', v_row.id::text, v_summary);
  return null;
end
$$;

create trigger audit_shopping_item after insert or update or delete on public.shopping_items
  for each row execute function private.audit_shopping_item();
create trigger audit_supply after insert or update or delete on public.supplies
  for each row execute function private.audit_supply();

revoke execute on function private.guard_shopping_item(), private.guard_supply(),
  private.audit_shopping_item(), private.audit_supply() from public, anon, authenticated;

-- RLS and grants -------------------------------------------------------------------------
alter table public.shopping_items enable row level security;
alter table public.shopping_items force row level security;
alter table public.supplies enable row level security;
alter table public.supplies force row level security;

revoke all on public.shopping_items, public.supplies from anon, authenticated;
grant select, insert, update, delete on public.shopping_items, public.supplies to authenticated;

create policy shopping_items_select on public.shopping_items for select to authenticated
  using (private.is_household_member(household_id));
create policy shopping_items_insert on public.shopping_items for insert to authenticated
  with check (private.is_household_member(household_id));
create policy shopping_items_update on public.shopping_items for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy shopping_items_delete on public.shopping_items for delete to authenticated
  using (private.is_household_member(household_id));

create policy supplies_select on public.supplies for select to authenticated
  using (private.is_household_member(household_id));
create policy supplies_insert on public.supplies for insert to authenticated
  with check (private.is_household_member(household_id));
create policy supplies_update on public.supplies for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy supplies_delete on public.supplies for delete to authenticated
  using (private.is_household_member(household_id));
