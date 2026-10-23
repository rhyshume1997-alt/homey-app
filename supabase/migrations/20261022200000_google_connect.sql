-- D17: Google data through each person's own sign-in (read-only scopes). Additive.
-- Refresh tokens are stored ENCRYPTED by the server (AES-256-GCM); the database never sees plaintext.
-- Each person can reach only their own row, through SECURITY DEFINER functions. No table grants.

create table private.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 1 and 4000),
  scopes text not null check (char_length(scopes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.google_tokens enable row level security;
alter table private.google_tokens force row level security;
revoke all on private.google_tokens from public, anon, authenticated;

create function public.store_my_google_token(p_ciphertext text, p_scopes text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select household_id into v_household from public.household_members
    where user_id = v_uid order by created_at limit 1;
  if v_household is null then raise exception 'not a member' using errcode = '42501'; end if;
  if p_ciphertext is null or char_length(p_ciphertext) not between 1 and 4000 or p_ciphertext !~ '^v1:'
     or p_scopes is null or char_length(p_scopes) > 1000 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  insert into private.google_tokens (user_id, household_id, ciphertext, scopes)
  values (v_uid, v_household, p_ciphertext, p_scopes)
  on conflict (user_id) do update set
    household_id = excluded.household_id, ciphertext = excluded.ciphertext,
    scopes = excluded.scopes, updated_at = now();
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_household, v_uid, 'google.connected', 'google_token', v_uid::text, 'Google connected (read-only)');
end
$$;

create function public.get_my_google_token() returns table (ciphertext text, scopes text)
language sql stable security definer
set search_path = ''
as $$
  select t.ciphertext, t.scopes from private.google_tokens t where t.user_id = (select auth.uid())
$$;

create function public.delete_my_google_token() returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from private.google_tokens where user_id = v_uid returning household_id into v_household;
  if v_household is not null then
    insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
    values (v_household, v_uid, 'google.disconnected', 'google_token', v_uid::text, 'Google disconnected');
  end if;
end
$$;

create function public.google_connection_status() returns table (connected boolean, scopes text, updated_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select true, t.scopes, t.updated_at from private.google_tokens t where t.user_id = (select auth.uid())
$$;

revoke execute on function public.store_my_google_token(text, text) from public, anon;
revoke execute on function public.get_my_google_token() from public, anon;
revoke execute on function public.delete_my_google_token() from public, anon;
revoke execute on function public.google_connection_status() from public, anon;
grant execute on function public.store_my_google_token(text, text) to authenticated;
grant execute on function public.get_my_google_token() to authenticated;
grant execute on function public.delete_my_google_token() to authenticated;
grant execute on function public.google_connection_status() to authenticated;

-- Latest parsed costs sheet per household, saved when a connected person views or refreshes it.
create table public.budget_snapshots (
  household_id uuid primary key references public.households (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  fetched_at timestamptz not null default now(),
  fetched_by uuid default auth.uid() references auth.users (id) on delete set null
);
alter table public.budget_snapshots enable row level security;
alter table public.budget_snapshots force row level security;
revoke all on public.budget_snapshots from public, anon, authenticated;
grant select, insert, update on public.budget_snapshots to authenticated;

create policy budget_snapshots_select on public.budget_snapshots for select to authenticated
  using (private.is_household_member(household_id));
create policy budget_snapshots_insert on public.budget_snapshots for insert to authenticated
  with check (private.is_household_member(household_id));
create policy budget_snapshots_update on public.budget_snapshots for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create function private.guard_budget_snapshot() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id then
    raise exception 'household is immutable' using errcode = '42501';
  end if;
  new.fetched_by := (select auth.uid());
  new.fetched_at := now();
  return new;
end
$$;
create trigger a_guard_budget_snapshot before insert or update on public.budget_snapshots
  for each row execute function private.guard_budget_snapshot();
revoke execute on function private.guard_budget_snapshot() from public, anon, authenticated;

-- No figures in the audit summary.
create function private.audit_budget_snapshot() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (new.household_id, (select auth.uid()), 'budget.snapshot_saved', 'budget_snapshot', new.household_id::text,
          'Costs sheet snapshot saved');
  return null;
end
$$;
create trigger audit_budget_snapshot after insert or update on public.budget_snapshots
  for each row execute function private.audit_budget_snapshot();
revoke execute on function private.audit_budget_snapshot() from public, anon, authenticated;
