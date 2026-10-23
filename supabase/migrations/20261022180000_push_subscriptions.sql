-- Web Push subscriptions (one row per browser/device). Additive.
-- Users manage only their own rows. They cannot update rows directly; delivery results are
-- recorded through push_record_result(), which can only touch the caller's own subscriptions.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  user_agent text check (user_agent is null or length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id));

-- Records a delivery result for one of the caller's own subscriptions.
create function public.push_record_result(p_id uuid, p_ok boolean) returns void
language sql security definer
set search_path = ''
as $$
  update public.push_subscriptions
  set last_success_at = case when p_ok then now() else last_success_at end,
      failure_count = case when p_ok then 0 else failure_count + 1 end
  where id = p_id
    and user_id = (select auth.uid())
    and private.is_household_member(household_id);
$$;
revoke execute on function public.push_record_result(uuid, boolean) from public, anon;
grant execute on function public.push_record_result(uuid, boolean) to authenticated;
