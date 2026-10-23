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
