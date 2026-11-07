-- The single point where row-level security learns who is calling.
-- Replacing the auth provider means changing this function and nothing else.
create schema if not exists app;

create function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

grant usage on schema app to authenticated;
revoke all on function app.current_user_id() from public, anon;
grant execute on function app.current_user_id() to authenticated;
