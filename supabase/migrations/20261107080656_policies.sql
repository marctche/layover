-- Row-level security. Every policy identifies the caller through app.current_user_id().
-- Helpers are security definer so policies on trip_members do not recurse into themselves.
-- They take no user argument for the caller, so they cannot probe other people's memberships.

create function app.is_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = app.current_user_id()
  )
$$;

create function app.is_coordinator(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = app.current_user_id() and m.role = 'coordinator'
  )
$$;

-- True when the given profile belongs to a trip the caller is in.
create function app.shares_trip_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members mine
    join public.trip_members theirs on theirs.trip_id = mine.trip_id
    where mine.user_id = app.current_user_id() and theirs.user_id = p_user_id
  )
$$;

revoke all on function app.is_member(uuid), app.is_coordinator(uuid), app.shares_trip_with(uuid) from public, anon;
grant execute on function app.is_member(uuid), app.is_coordinator(uuid), app.shares_trip_with(uuid) to authenticated;

-- Start from nothing. Supabase grants broad table privileges by default.
revoke all on all tables in schema public from anon, authenticated;

-- profiles: yourself and people you share a trip with. You can edit your own name.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = app.current_user_id() or app.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = app.current_user_id()) with check (id = app.current_user_id());

-- trips: members read. Created only by public.create_trip.
grant select on public.trips to authenticated;
create policy trips_select on public.trips for select to authenticated
  using (app.is_member(id));

-- trip_members: every member sees the full list. There is no write policy and no write grant:
-- rows are created only by public.create_trip and public.join_with_invite.
grant select on public.trip_members to authenticated;
create policy trip_members_select on public.trip_members for select to authenticated
  using (app.is_member(trip_id));

-- invitations: the coordinator manages them. Members cannot see them.
-- Only revoked_at may change, and only to a value (a revocation cannot be undone).
grant select, insert on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (app.is_coordinator(trip_id));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    app.is_coordinator(trip_id)
    and created_by = app.current_user_id()
    and revoked_at is null
    and expires_at > now()
    and expires_at <= now() + interval '90 days'
  );
create policy invitations_revoke on public.invitations for update to authenticated
  using (app.is_coordinator(trip_id) and revoked_at is null)
  with check (app.is_coordinator(trip_id) and revoked_at is not null);

-- destinations: members read and suggest, as themselves.
grant select, insert on public.destinations to authenticated;
create policy destinations_select on public.destinations for select to authenticated
  using (app.is_member(trip_id));
create policy destinations_insert on public.destinations for insert to authenticated
  with check (app.is_member(trip_id) and suggested_by = app.current_user_id());

-- destination_preferences: members read everyone's (the group compares them); write only your own.
grant select, insert, update, delete on public.destination_preferences to authenticated;
create policy preferences_select on public.destination_preferences for select to authenticated
  using (app.is_member(trip_id));
create policy preferences_insert on public.destination_preferences for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy preferences_update on public.destination_preferences for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy preferences_delete on public.destination_preferences for delete to authenticated
  using (user_id = app.current_user_id());

-- member_budgets: owner only. No coordinator clause, no view, no helper function reads this table.
grant select, insert, update, delete on public.member_budgets to authenticated;
create policy budgets_select on public.member_budgets for select to authenticated
  using (user_id = app.current_user_id());
create policy budgets_insert on public.member_budgets for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy budgets_update on public.member_budgets for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(trip_id));
create policy budgets_delete on public.member_budgets for delete to authenticated
  using (user_id = app.current_user_id());
