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
