-- AI assistant: spend ledger and pending proposals. Additive only.
-- The assistant proposes; a person confirms. Usage rows are written only by record_ai_usage().

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  month date not null check (month = date_trunc('month', month)::date),
  model text not null check (model ~ '^claude-[a-z0-9.-]{1,80}$'),
  input_tokens int not null check (input_tokens between 0 and 10000000),
  output_tokens int not null check (output_tokens between 0 and 10000000),
  cost_pence int not null check (cost_pence between 0 and 10000),
  created_at timestamptz not null default now()
);
create index ai_usage_household_month_idx on public.ai_usage (household_id, month);

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (private.is_household_member(household_id));

-- The only write path. Checks membership and validates every value.
create function public.record_ai_usage(
  p_household_id uuid, p_model text, p_input_tokens int, p_output_tokens int, p_cost_pence int
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_model is null or p_model !~ '^claude-[a-z0-9.-]{1,80}$'
     or p_input_tokens is null or p_input_tokens not between 0 and 10000000
     or p_output_tokens is null or p_output_tokens not between 0 and 10000000
     or p_cost_pence is null or p_cost_pence not between 0 and 10000 then
    raise exception 'invalid usage values' using errcode = '22023';
  end if;
  insert into public.ai_usage (household_id, user_id, month, model, input_tokens, output_tokens, cost_pence)
  values (
    p_household_id, v_uid, date_trunc('month', now() at time zone 'UTC')::date,
    p_model, p_input_tokens, p_output_tokens, p_cost_pence
  );
end
$$;
revoke execute on function public.record_ai_usage(uuid, text, int, int, int) from public, anon;
grant execute on function public.record_ai_usage(uuid, text, int, int, int) to authenticated;

create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null check (kind in ('create_task', 'create_snag', 'add_shopping_item', 'note')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_proposals_household_status_idx on public.ai_proposals (household_id, status, created_at desc);

create trigger a_guard_owned_row before insert or update on public.ai_proposals
  for each row execute function private.guard_owned_row();

-- Inserts are always pending; the only update is pending -> confirmed/rejected.
create function private.guard_ai_proposal() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'proposals start pending' using errcode = '42501';
    end if;
    new.decided_by := null;
    new.decided_at := null;
  else
    if old.status <> 'pending' then
      raise exception 'proposal already decided' using errcode = '42501';
    end if;
    if new.status not in ('confirmed', 'rejected') then
      raise exception 'invalid status change' using errcode = '42501';
    end if;
    if new.kind is distinct from old.kind or new.payload is distinct from old.payload then
      raise exception 'proposal content is immutable' using errcode = '42501';
    end if;
    new.decided_by := v_uid;
    new.decided_at := now();
  end if;
  return new;
end
$$;
create trigger b_guard_ai_proposal before insert or update on public.ai_proposals
  for each row execute function private.guard_ai_proposal();

create function private.audit_ai_proposal() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'ai.proposed';
  elsif new.status = 'confirmed' then
    v_action := 'ai.confirmed';
  else
    v_action := 'ai.rejected';
  end if;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (
    new.household_id, (select auth.uid()), v_action, 'ai_proposal', new.id::text,
    left(new.kind || ': ' || coalesce(new.payload ->> 'title', new.payload ->> 'text', ''), 500),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end
$$;
create trigger audit_ai_proposal after insert or update on public.ai_proposals
  for each row execute function private.audit_ai_proposal();

revoke execute on function private.guard_ai_proposal() from public, anon, authenticated;
revoke execute on function private.audit_ai_proposal() from public, anon, authenticated;

alter table public.ai_proposals enable row level security;
alter table public.ai_proposals force row level security;
revoke all on public.ai_proposals from anon, authenticated;
grant select, insert, update on public.ai_proposals to authenticated;

create policy ai_proposals_select on public.ai_proposals for select to authenticated
  using (private.is_household_member(household_id));
create policy ai_proposals_insert on public.ai_proposals for insert to authenticated
  with check (private.is_household_member(household_id) and status = 'pending');
create policy ai_proposals_update on public.ai_proposals for update to authenticated
  using (private.is_household_member(household_id) and status = 'pending')
  with check (private.is_household_member(household_id) and status in ('confirmed', 'rejected'));
