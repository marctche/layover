-- Setup flow backend: budget bands, a richer invite preview, and removing a candidate city.

-- 1. Budget band. The band is what the traveler picks; ceiling_minor is derived from it by the
-- app (the band's top in the trip currency) and is null for the open-ended top band. Owner-only
-- row-level security already covers the whole row, so there is no policy change.
alter table public.member_budgets
  add column band text check (band in ('under_2k', '2k_3k', '3k_4k', '4k_plus')),
  alter column ceiling_minor drop not null,
  add constraint member_budgets_band_or_ceiling check (band is not null or ceiling_minor is not null);

-- 2. Invite preview. The return columns change, so the function is dropped and recreated, and
-- the grants are repeated. Same shape as before: security definer, empty result for every
-- kind of bad token, and nothing about the trip beyond these fields.
drop function public.invite_preview(text);

create function public.invite_preview(p_token text)
returns table (
  trip_name text,
  inviter_name text,
  member_count integer,
  start_date date,
  end_date date,
  departure_airport text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.name,
    p.display_name,
    (select count(*)::integer from public.trip_members m where m.trip_id = t.id),
    t.start_date,
    t.end_date,
    c.departure_airport
  from public.invitations i
  join public.trips t on t.id = i.trip_id
  join public.profiles p on p.id = i.created_by
  left join public.trip_constraints c on c.trip_id = t.id
  where p_token is not null
    and char_length(p_token) between 32 and 256
    and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and i.revoked_at is null
    and i.expires_at > now()
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- 3. Removing a candidate city: coordinator only. Every foreign key to destinations already
-- cascades (preferences, destination_constraints, trip_fixed_events, quotes) or clears the
-- reference (trip_constraints start and end), so a delete never leaves a dangling row.
grant delete on public.destinations to authenticated;
create policy destinations_delete on public.destinations for delete to authenticated
  using (app.is_coordinator(trip_id));
