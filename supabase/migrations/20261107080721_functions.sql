-- The only ways to create or end a trip membership.

create function public.create_trip(
  p_name text,
  p_base_currency text,
  p_start_date date default null,
  p_end_date date default null,
  p_group_target_minor bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_trip uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.trips (name, start_date, end_date, group_target_minor, base_currency, created_by)
  values (btrim(p_name), p_start_date, p_end_date, p_group_target_minor, p_base_currency, v_user)
  returning id into v_trip;

  insert into public.trip_members (trip_id, user_id, role) values (v_trip, v_user, 'coordinator');
  return v_trip;
end;
$$;

-- Takes the plaintext token and hashes it here, so a stored hash is never a usable credential.
-- Unknown, expired and revoked tokens are indistinguishable to the caller.
-- The link is reusable; the primary key on trip_members stops the same user joining twice.
create function public.join_with_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_trip uuid;
  v_invite uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256 then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  select i.id, i.trip_id into v_invite, v_trip
  from public.invitations i
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and i.revoked_at is null and i.expires_at > now();
  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.trip_members m where m.trip_id = v_trip and m.user_id = v_user) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.trip_members (trip_id, user_id, role, joined_via)
  values (v_trip, v_user, 'member', v_invite);

  return v_trip;
exception
  -- A concurrent join by the same user lost the race on the primary key.
  when unique_violation then
    raise exception 'already_member' using errcode = 'P0001';
end;
$$;

-- Coordinator-only removal. Preferences and the member's budget go with the membership
-- (cascade). Destinations they suggested stay. Returns nothing, so it exposes no data.
create function public.remove_member(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not app.is_coordinator(p_trip_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = v_user then
    raise exception 'cannot_remove_self' using errcode = 'P0001';
  end if;

  delete from public.trip_members where trip_id = p_trip_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.create_trip(text, text, date, date, bigint) from public, anon;
revoke all on function public.join_with_invite(text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_trip(text, text, date, date, bigint) to authenticated;
grant execute on function public.join_with_invite(text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
