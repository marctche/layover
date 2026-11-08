-- Sign-in support: required display names, an invite preview for signed-out visitors,
-- and a trip id on the already_member error so the app can send the member to their trip.

-- New profiles start with an empty name unless the identity provider supplied one.
-- The app asks for a name before anything else, so an email prefix is never shown.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        ''
      ),
      80
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- What a signed-out visitor may learn from an invite link: the trip name, who sent it
-- and how many people are in. Unknown, expired, revoked and malformed tokens all return
-- the same empty result.
create function public.invite_preview(p_token text)
returns table (trip_name text, inviter_name text, member_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.name,
    p.display_name,
    (select count(*)::integer from public.trip_members m where m.trip_id = t.id)
  from public.invitations i
  join public.trips t on t.id = i.trip_id
  join public.profiles p on p.id = i.created_by
  where p_token is not null
    and char_length(p_token) between 32 and 256
    and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and i.revoked_at is null
    and i.expires_at > now()
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- Same behavior as before, plus the trip id in the error detail for already_member.
create or replace function public.join_with_invite(p_token text)
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
    raise exception 'already_member' using errcode = 'P0001', detail = v_trip::text;
  end if;

  insert into public.trip_members (trip_id, user_id, role, joined_via)
  values (v_trip, v_user, 'member', v_invite);

  return v_trip;
exception
  -- A concurrent join by the same user lost the race on the primary key.
  when unique_violation then
    raise exception 'already_member' using errcode = 'P0001', detail = v_trip::text;
end;
$$;
