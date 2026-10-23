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
