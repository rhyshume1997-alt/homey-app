-- Document vault: private storage bucket + documents table. Additive only.
-- Creating the bucket in a real project is a remote change: apply only with Alex's OK.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
)
on conflict do nothing;

-- Object names are "<household_id>/<document uuid>/<safe filename>". The first folder
-- must be a household the caller belongs to. A malformed first folder never matches
-- (checked with a strict pattern before the cast, so it denies instead of erroring).
create function private.storage_household(name text) returns uuid
language sql stable
set search_path = ''
as $$
  select case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
    else null
  end
$$;
revoke execute on function private.storage_household(text) from public, anon;
grant execute on function private.storage_household(text) to authenticated;

-- No update policy (objects are immutable), no anon policy (deny by default).
create policy documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and private.is_household_member(private.storage_household(name)));
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and private.is_household_member(private.storage_household(name)));
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and private.is_household_member(private.storage_household(name)));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  category text not null check (category in (
    'property', 'mortgage', 'insurance', 'energy', 'solar', 'warranty', 'council', 'identity', 'other'
  )),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 20971520),
  issued_on date,
  expires_on date,
  renewal_date date,
  record_id uuid references public.household_records (id) on delete set null,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_path_in_household check (storage_path like household_id::text || '/%')
);
create index documents_household_idx on public.documents (household_id, category);
create index documents_expires_idx on public.documents (household_id, expires_on);

create trigger a_guard_owned_row before insert or update on public.documents
  for each row execute function private.guard_owned_row();

-- A linked record must belong to the same household; the object path never changes.
create function private.guard_document() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.record_id is not null
     and (tg_op = 'INSERT' or new.record_id is distinct from old.record_id)
     and not exists (
       select 1 from public.household_records r
       where r.id = new.record_id and r.household_id = new.household_id
     ) then
    raise exception 'record must belong to the same household' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.storage_path is distinct from old.storage_path then
    raise exception 'storage_path is immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger b_guard_document before insert or update on public.documents
  for each row execute function private.guard_document();
revoke execute on function private.guard_document() from public, anon, authenticated;

-- Audit (AFTER). Summary is the title only.
create function private.audit_document() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.documents;
begin
  v_action := case tg_op when 'INSERT' then 'document.added' when 'DELETE' then 'document.deleted' else 'document.updated' end;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (
    v_row.household_id, (select auth.uid()), v_action, 'document', v_row.id::text, left(v_row.title, 500),
    case when tg_op = 'INSERT' then null else to_jsonb(old) - 'notes' - 'storage_path' end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) - 'notes' - 'storage_path' end
  );
  return null;
end
$$;
create trigger audit_document after insert or update or delete on public.documents
  for each row execute function private.audit_document();
revoke execute on function private.audit_document() from public, anon, authenticated;

alter table public.documents enable row level security;
alter table public.documents force row level security;

revoke all on public.documents from anon, authenticated;
grant select, insert, update, delete on public.documents to authenticated;

create policy documents_select on public.documents for select to authenticated
  using (private.is_household_member(household_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (private.is_household_member(household_id));
create policy documents_update on public.documents for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy documents_delete on public.documents for delete to authenticated
  using (private.is_household_member(household_id));
