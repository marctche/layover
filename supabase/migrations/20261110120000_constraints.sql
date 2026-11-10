-- Planning constraints the route engine reads, plus per-member availability, home airport
-- and budget flexibility.
--
-- Every table here holds CONFIRMED values only: something a person entered or accepted.
-- Suggestions are not stored here.

-- Confirmed trip dates stay on trips (nullable: a trip can exist before dates are known).
-- Only the coordinator changes them, only these two columns, and only while the trip is
-- still being planned (an approved trip's dates do not move under the group).
grant update (start_date, end_date) on public.trips to authenticated;
create policy trips_update_dates on public.trips for update to authenticated
  using (app.is_coordinator(id) and status = 'planning')
  with check (app.is_coordinator(id) and status = 'planning');

-- One row per trip. All fields optional; the coordinator writes it.
create table public.trip_constraints (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  -- Departure airport label for the group. The engine models one shared home for now, so
  -- this is stored for display and later per-member homes; it is not read by the engine.
  departure_airport text check (departure_airport ~ '^[A-Z]{3}$'),
  start_destination_id uuid,
  end_destination_id uuid,
  -- Approximate window and length, for trips whose exact dates are not confirmed yet.
  earliest_start date,
  latest_end date,
  min_nights integer check (min_nights between 1 and 365),
  max_nights integer check (max_nights between 1 and 365),
  updated_at timestamptz not null default now(),
  check (earliest_start is null or latest_end is null or latest_end > earliest_start),
  check (min_nights is null or max_nights is null or max_nights >= min_nights),
  foreign key (trip_id, start_destination_id) references public.destinations (trip_id, id)
    on delete set null (start_destination_id),
  foreign key (trip_id, end_destination_id) references public.destinations (trip_id, id)
    on delete set null (end_destination_id)
);

-- Per-destination stay rules. A destination without a row: at least one night, no maximum,
-- optional (listed cities are optional by default).
create table public.destination_constraints (
  trip_id uuid not null,
  destination_id uuid primary key,
  min_nights integer not null default 1 check (min_nights between 1 and 365),
  max_nights integer check (max_nights between 1 and 365),
  must_include boolean not null default false,
  -- Cities with a position must be visited in ascending position order; others may sit between.
  lock_position integer check (lock_position between 1 and 100),
  updated_at timestamptz not null default now(),
  check (max_nights is null or max_nights >= min_nights),
  foreign key (trip_id, destination_id) references public.destinations (trip_id, id) on delete cascade
);
create unique index destination_constraints_lock_idx
  on public.destination_constraints (trip_id, lock_position) where lock_position is not null;
create index destination_constraints_trip_id_idx on public.destination_constraints (trip_id);

-- The group must sleep in the destination on every night from start_date through end_date inclusive.
create table public.trip_fixed_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  destination_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (trip_id, destination_id) references public.destinations (trip_id, id) on delete cascade
);
create index trip_fixed_events_trip_id_idx on public.trip_fixed_events (trip_id);

-- Per-member availability: how many days either side the member can shift, plus the date
-- ranges they can travel. Visible to the group, written by the member. The engine does not
-- read these yet (it plans one group window).
create table public.member_availability (
  trip_id uuid not null,
  user_id uuid not null,
  flexibility_days smallint not null default 0 check (flexibility_days between 0 and 60),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);

create table public.member_availability_ranges (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  user_id uuid not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
create index member_availability_ranges_member_idx on public.member_availability_ranges (trip_id, user_id);

-- Private budgets gain a currency (may differ from the trip's; stored, never converted here)
-- and an optional flexibility: how far above the ceiling the member would stretch, in the
-- budget's own currency. Both stay under the owner-only policies already on this table.
alter table public.member_budgets add column currency text check (currency ~ '^[A-Z]{3}$');
update public.member_budgets b set currency = t.base_currency from public.trips t where t.id = b.trip_id;
alter table public.member_budgets alter column currency set not null;
-- A write that names no currency gets the trip's, so existing callers keep working.
create function app.default_budget_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is null then
    select t.base_currency into new.currency from public.trips t where t.id = new.trip_id;
  end if;
  return new;
end;
$$;
revoke all on function app.default_budget_currency() from public, anon, authenticated;
create trigger budget_default_currency before insert on public.member_budgets
  for each row execute function app.default_budget_currency();
alter table public.member_budgets add column flexibility_minor bigint check (flexibility_minor >= 0);

-- Access. Start each new table from nothing, then grant exactly what the policies allow.
alter table public.trip_constraints enable row level security;
alter table public.destination_constraints enable row level security;
alter table public.trip_fixed_events enable row level security;
alter table public.member_availability enable row level security;
alter table public.member_availability_ranges enable row level security;
revoke all on public.trip_constraints, public.destination_constraints, public.trip_fixed_events,
  public.member_availability, public.member_availability_ranges from anon, authenticated;

-- Trip and destination constraints and fixed events: members read, the coordinator writes.
grant select, insert, update, delete on public.trip_constraints to authenticated;
create policy trip_constraints_select on public.trip_constraints for select to authenticated
  using (app.is_member(trip_id));
create policy trip_constraints_insert on public.trip_constraints for insert to authenticated
  with check (app.is_coordinator(trip_id));
create policy trip_constraints_update on public.trip_constraints for update to authenticated
  using (app.is_coordinator(trip_id)) with check (app.is_coordinator(trip_id));
create policy trip_constraints_delete on public.trip_constraints for delete to authenticated
  using (app.is_coordinator(trip_id));

grant select, insert, update, delete on public.destination_constraints to authenticated;
create policy destination_constraints_select on public.destination_constraints for select to authenticated
  using (app.is_member(trip_id));
create policy destination_constraints_insert on public.destination_constraints for insert to authenticated
  with check (app.is_coordinator(trip_id));
create policy destination_constraints_update on public.destination_constraints for update to authenticated
  using (app.is_coordinator(trip_id)) with check (app.is_coordinator(trip_id));
create policy destination_constraints_delete on public.destination_constraints for delete to authenticated
  using (app.is_coordinator(trip_id));

grant select, insert, delete on public.trip_fixed_events to authenticated;
create policy trip_fixed_events_select on public.trip_fixed_events for select to authenticated
  using (app.is_member(trip_id));
create policy trip_fixed_events_insert on public.trip_fixed_events for insert to authenticated
  with check (app.is_coordinator(trip_id));
create policy trip_fixed_events_delete on public.trip_fixed_events for delete to authenticated
  using (app.is_coordinator(trip_id));

-- Availability: the group reads, each member writes only their own rows.
grant select, insert, update, delete on public.member_availability to authenticated;
create policy member_availability_select on public.member_availability for select to authenticated
  using (app.is_member(trip_id));
create policy member_availability_insert on public.member_availability for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy member_availability_update on public.member_availability for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy member_availability_delete on public.member_availability for delete to authenticated
  using (user_id = app.current_user_id());

grant select, insert, delete on public.member_availability_ranges to authenticated;
create policy member_availability_ranges_select on public.member_availability_ranges for select to authenticated
  using (app.is_member(trip_id));
create policy member_availability_ranges_insert on public.member_availability_ranges for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy member_availability_ranges_delete on public.member_availability_ranges for delete to authenticated
  using (user_id = app.current_user_id());

-- Replaces the caller's availability in one transaction. Security invoker: the policies
-- above still decide what the caller may write.
create function public.set_my_availability(p_trip_id uuid, p_flexibility_days integer, p_ranges jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not app.is_member(p_trip_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' or jsonb_array_length(p_ranges) > 20 then
    raise exception 'invalid_ranges' using errcode = '22023';
  end if;

  insert into public.member_availability (trip_id, user_id, flexibility_days, updated_at)
  values (p_trip_id, v_user, p_flexibility_days, now())
  on conflict (trip_id, user_id) do update
    set flexibility_days = excluded.flexibility_days, updated_at = excluded.updated_at;

  delete from public.member_availability_ranges where trip_id = p_trip_id and user_id = v_user;
  insert into public.member_availability_ranges (trip_id, user_id, start_date, end_date)
  select p_trip_id, v_user, (r ->> 'start_date')::date, (r ->> 'end_date')::date
  from jsonb_array_elements(p_ranges) as r;
end;
$$;

revoke all on function public.set_my_availability(uuid, integer, jsonb) from public, anon;
grant execute on function public.set_my_availability(uuid, integer, jsonb) to authenticated;
