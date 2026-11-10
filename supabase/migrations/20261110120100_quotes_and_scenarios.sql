-- Prices the route engine runs on, and the saved results of engine runs.

-- One quote per row. Every price carries its source, and a signed-in user can only ever
-- write source 'manual': live, estimate and synthetic rows come only from server code
-- holding the secret key, so no client can label a price as live.
--
-- kind 'leg': one way, per person. Each end is a destination of this trip, or the traveler's
--   home (the end left null). City-to-city legs name both ends; at least one end is named.
-- kind 'long_haul_fare': one ticket for both directions from home, flying into
--   to_destination_id at the start and home from return_from_destination_id at the end.
-- The engine models one shared home, so there is no per-traveler home on a quote yet.
-- origin_airport and destination_airport record the airports actually flown, as labels.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('leg', 'long_haul_fare')),
  mode text not null check (mode in ('flight', 'train', 'bus')),
  from_destination_id uuid,
  to_destination_id uuid,
  return_from_destination_id uuid,
  origin_airport text check (origin_airport ~ '^[A-Z]{3}$'),
  destination_airport text check (destination_airport ~ '^[A-Z]{3}$'),
  -- Leg duration, or the outbound duration of a fare.
  duration_minutes integer not null check (duration_minutes > 0),
  return_minutes integer check (return_minutes > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  adults smallint not null default 1 check (adults >= 1),
  source text not null check (source in ('live', 'manual', 'estimate', 'synthetic')),
  provider text check (char_length(provider) between 1 and 80),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > fetched_at),
  check (
    (
      kind = 'leg'
      and return_from_destination_id is null
      and return_minutes is null
      and (from_destination_id is not null or to_destination_id is not null)
      and from_destination_id is distinct from to_destination_id
    )
    or (
      kind = 'long_haul_fare'
      and mode = 'flight'
      and from_destination_id is null
      and to_destination_id is not null
      and return_from_destination_id is not null
      and return_minutes is not null
    )
  ),
  foreign key (trip_id, from_destination_id) references public.destinations (trip_id, id) on delete cascade,
  foreign key (trip_id, to_destination_id) references public.destinations (trip_id, id) on delete cascade,
  foreign key (trip_id, return_from_destination_id) references public.destinations (trip_id, id) on delete cascade
);
create index quotes_trip_id_idx on public.quotes (trip_id);

-- A saved engine run. `input` is the exact engine input (it never contains budgets) and
-- `input_hash` its SHA-256, so the same input reuses the saved run and a changed trip shows
-- as stale. Rows are never edited.
create table public.route_scenarios (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  engine_version text not null check (char_length(engine_version) between 1 and 40),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  input jsonb not null,
  result jsonb not null,
  ok boolean not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, engine_version, input_hash)
);

alter table public.quotes enable row level security;
alter table public.route_scenarios enable row level security;
revoke all on public.quotes, public.route_scenarios from anon, authenticated;

-- quotes: members read; the coordinator adds manual prices as themselves and removes quotes.
grant select, insert, delete on public.quotes to authenticated;
create policy quotes_select on public.quotes for select to authenticated
  using (app.is_member(trip_id));
create policy quotes_insert_manual on public.quotes for insert to authenticated
  with check (
    app.is_coordinator(trip_id)
    and source = 'manual'
    and created_by = app.current_user_id()
  );
create policy quotes_delete on public.quotes for delete to authenticated
  using (app.is_coordinator(trip_id));

-- route_scenarios: members read and save runs as themselves. No update or delete.
-- Known limit: a member's own session can insert any result JSON; created_by makes that
-- attributable. Closing it needs runs written by server code only.
grant select, insert on public.route_scenarios to authenticated;
create policy route_scenarios_select on public.route_scenarios for select to authenticated
  using (app.is_member(trip_id));
create policy route_scenarios_insert on public.route_scenarios for insert to authenticated
  with check (app.is_member(trip_id) and created_by = app.current_user_id());
