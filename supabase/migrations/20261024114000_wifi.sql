-- Guest wifi. Additive only. The password is only ever stored as application-layer ciphertext
-- (AES-256-GCM, AAD "wifi:"+household_id); the audit summary carries the network name only.

create table public.wifi_networks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ssid text not null check (length(ssid) between 1 and 32),
  security text not null default 'WPA' check (security in ('WPA', 'WEP', 'nopass')),
  password_ciphertext text check (password_ciphertext is null or length(password_ciphertext) between 1 and 1000),
  hidden boolean not null default false,
  is_guest boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((security = 'nopass') = (password_ciphertext is null))
);
create index wifi_networks_household_idx on public.wifi_networks (household_id);

create trigger a_guard_owned_row before insert or update on public.wifi_networks
  for each row execute function private.guard_owned_row();

create function private.audit_wifi_network() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.wifi_networks;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_action := case tg_op when 'INSERT' then 'wifi.added' when 'DELETE' then 'wifi.removed' else 'wifi.updated' end;
  -- Summary is the network name only: never the password or ciphertext.
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_row.household_id, (select auth.uid()), v_action, 'wifi_network', v_row.id::text, left(v_row.ssid, 100));
  return null;
end
$$;

create trigger audit_wifi_network after insert or update or delete on public.wifi_networks
  for each row execute function private.audit_wifi_network();

revoke execute on function private.audit_wifi_network() from public, anon, authenticated;

alter table public.wifi_networks enable row level security;
alter table public.wifi_networks force row level security;

revoke all on public.wifi_networks from anon, authenticated;
grant select, insert, update, delete on public.wifi_networks to authenticated;

create policy wifi_networks_select on public.wifi_networks for select to authenticated
  using (private.is_household_member(household_id));
create policy wifi_networks_insert on public.wifi_networks for insert to authenticated
  with check (private.is_household_member(household_id));
create policy wifi_networks_update on public.wifi_networks for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy wifi_networks_delete on public.wifi_networks for delete to authenticated
  using (private.is_household_member(household_id));
