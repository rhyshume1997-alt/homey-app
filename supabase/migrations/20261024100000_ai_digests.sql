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
