-- Exact private budgets. The traveler types an amount; everyone else in the trip sees only the
-- band it falls in. ceiling_minor now holds the exact amount (the source of truth) and `band`
-- is always derived from it, so the two can never disagree.

-- 1. Band boundaries, in whole currency units, mirrored by bandForAmount in src/domain/budget/bands.ts:
-- under_2k below 2000, 2k_3k from 2000 up to 3000, 3k_4k from 3000 up to 4000, 4k_plus from 4000.
-- Minor units per major unit follow the currency (0, 2 or 3 decimals). Internal: only the
-- trigger below calls it, so nothing is granted.
create function app.budget_band(p_amount_minor bigint, p_currency text)
returns text
language sql
immutable
set search_path = ''
as $$
  with u as (
    select case
      when p_currency in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 1::bigint
      when p_currency in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 1000::bigint
      else 100::bigint
    end as unit
  )
  select case
    when p_amount_minor < 2000 * u.unit then 'under_2k'
    when p_amount_minor < 3000 * u.unit then '2k_3k'
    when p_amount_minor < 4000 * u.unit then '3k_4k'
    else '4k_plus'
  end
  from u
$$;
revoke all on function app.budget_band(bigint, text) from public, anon, authenticated;

-- 2. Legacy rows stored a band and a ceiling that was only the band's top, not an amount the
-- traveler typed. Clear that ceiling (the band is kept) so the traveler enters a real amount.
-- Rows with an amount and no band get their band from the trigger in the next step.
update public.member_budgets set ceiling_minor = null where band is not null;

-- 3. The band follows the amount on every insert and update, whatever the client sends. A row
-- with no amount (legacy only) keeps its band.
create function app.sync_budget_band()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ceiling_minor is not null then
    new.band := app.budget_band(new.ceiling_minor, new.currency);
  end if;
  return new;
end;
$$;
revoke all on function app.sync_budget_band() from public, anon, authenticated;
-- Named so it fires after budget_default_currency (triggers run in name order), which fills currency.
create trigger budget_sync_band before insert or update on public.member_budgets
  for each row execute function app.sync_budget_band();

update public.member_budgets set ceiling_minor = ceiling_minor where ceiling_minor is not null;

-- 4. What the group may see: the band of each member of the trip, nothing else. Security
-- definer so it can read the owner-only table; it returns user_id and band only, never
-- ceiling_minor, and an empty set for anyone who is not a member of the trip (anonymous
-- included, because app.is_member is false without a signed-in user).
create function public.trip_member_bands(p_trip_id uuid)
returns table (user_id uuid, band text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.user_id, b.band
  from public.member_budgets b
  where p_trip_id is not null
    and b.trip_id = p_trip_id
    and b.band is not null
    and app.is_member(p_trip_id)
$$;

revoke all on function public.trip_member_bands(uuid) from public, anon;
grant execute on function public.trip_member_bands(uuid) to authenticated;
