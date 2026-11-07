-- Tables. Access rules live in the next migration.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  start_date date,
  end_date date,
  status text not null default 'planning' check (status in ('planning', 'approved')),
  -- Shared benchmark in minor units of base_currency. Not an individual limit.
  group_target_minor bigint check (group_target_minor >= 0),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((start_date is null) = (end_date is null)),
  check (end_date is null or end_date >= start_date)
);

-- A reusable link: anyone holding the token can join until it expires or is revoked.
-- Only the SHA-256 of the token is stored.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index invitations_trip_id_idx on public.invitations (trip_id);

create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('coordinator', 'member')),
  home_airport text check (home_airport ~ '^[A-Z]{3}$'),
  joined_via uuid references public.invitations (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create unique index trip_members_one_coordinator on public.trip_members (trip_id) where role = 'coordinator';
create index trip_members_user_id_idx on public.trip_members (user_id);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  -- Tied to the profile, not the membership, so suggestions stay when a member is removed.
  suggested_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (trip_id, id),
  foreign key (trip_id) references public.trips (id) on delete cascade
);
create unique index destinations_trip_name_idx on public.destinations (trip_id, lower(btrim(name)));

create table public.destination_preferences (
  trip_id uuid not null,
  destination_id uuid not null,
  user_id uuid not null,
  score smallint not null check (score between -2 and 2),
  updated_at timestamptz not null default now(),
  primary key (destination_id, user_id),
  foreign key (trip_id, destination_id) references public.destinations (trip_id, id) on delete cascade,
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);

-- Private. Readable and writable by its owner only; see the policies migration.
create table public.member_budgets (
  trip_id uuid not null,
  user_id uuid not null,
  ceiling_minor bigint not null check (ceiling_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);

-- A profile row for every new auth user.
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.invitations enable row level security;
alter table public.trip_members enable row level security;
alter table public.destinations enable row level security;
alter table public.destination_preferences enable row level security;
alter table public.member_budgets enable row level security;
