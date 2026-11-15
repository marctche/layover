# Layover: Architecture

## Stack

| Concern | Choice | Notes |
|---|---|---|
| App | Next.js (App Router), React, TypeScript, Tailwind | One deployable app, with no separate backend service |
| Server logic | Server actions and route handlers, Zod at every boundary | |
| Data and auth | Supabase Postgres, Supabase Auth, row-level security | Migrations live in `supabase/migrations` |
| Tests | Vitest: unit tests, SQL-level access-control tests and real sign-in tests against a Supabase stack | |
| Deploy | Vercel and Supabase | |

## Module layout

```
src/
  app/            Next.js routes, layouts, server actions (thin: parse, authorize, call services),
                  with shared UI components in app/_components
  server/         Application services: sign-in, trips, invitations, destinations and preferences,
                  budgets, constraints, quotes, saved route scenarios. Owns authorization checks
                  and database access.
  domain/         Pure TypeScript: no I/O, no Next.js or Supabase imports
    dates/        UTC date and night arithmetic
    money/        Integer minor units, currency-safe arithmetic, formatting
    trip/         Trip input types: cities, legs, travelers, events, preferences
    engine/       Validation, route search, night allocation, costs, Pareto selection,
                  route comparison, add/remove simulation, per-viewer redaction
    planner/      Search planning: which city pairs and dates to price, and in what order
    airports/, cities/, budget/   Catalog search and budget bands
  pricing/        Flight price provider (SerpApi), response verification, price flags, disk cache
  db/             Supabase clients and environment handling
  data/           City and airport catalogs
supabase/
  migrations/     Schema, row-level security policies, SQL functions
tests/
  db/, auth/      SQL-level access-control tests and real sign-in tests
  fixtures/       The Asia trip scenario
```

**Why `domain/` is pure:** the route, constraint and cost logic is the part that must be correct and defensible. With no I/O it is:
- fast to unit test;
- reusable from server actions and scripts;
- independent of the database and the framework.

## Data model

| Table | Holds |
|---|---|
| `profiles` | One per auth user: display name (empty until the user sets it, or taken from the identity provider). Visible to the user and to people who share a trip with them |
| `trips` | Name, confirmed start and end dates (both or neither; coordinator-editable while planning), status, group target budget (a shared benchmark, not an individual limit), base currency (always chosen explicitly) |
| `trip_members` | Trip, user, role (`coordinator` or `member`), home airport. Rows are created and ended only by the `create_trip`, `join_with_invite` and `remove_member` SQL functions, never by direct insert or delete. Removal is coordinator-only and takes the member's preferences and budget with it |
| `invitations` | Trip, SHA-256 of a 256-bit token (the token itself is never stored), expiry, revoked_at. A reusable link: anyone holding it can join until it expires or is revoked. A member's row records the link they used (`joined_via`) |
| `destinations` | Trip-scoped candidate cities, suggested_by (kept if the suggester is later removed) |
| `destination_preferences` | Member, destination, score from -2 to 2. Visible to every member, writable by its owner |
| `trip_constraints` | One row per trip, written by the coordinator: optional start and end city, departure airport label, and an approximate date window with a length range for trips whose dates are not confirmed. Confirmed dates stay on `trips` |
| `destination_constraints` | Per destination, coordinator-written: minimum and maximum nights, must-visit, lock position. A destination without a row means at least one night, no maximum, optional |
| `trip_fixed_events` | A labelled date range the group must spend in one destination |
| `member_availability`, `member_availability_ranges` | Per member: date ranges they can travel and how many days they can shift. Visible to every member, writable by its owner |
| `member_budgets` | Member, exact budget in minor units (`ceiling_minor`), derived band, currency (never converted), optional flexibility above the ceiling. **Readable by its owner only.** Never joined into group-visible queries |
| `quotes` | Leg or long-haul fare, mode, amount in minor units, currency, adults, source (`live`, `manual`, `estimate`, `synthetic`), provider, fetched_at, expires_at. Members read; the coordinator adds manual quotes only; live, estimate and synthetic rows are written by server code with the secret key |
| `route_scenarios` | Saved engine runs: exact input, result, input hash and engine version, unique per trip. Immutable. The input never contains budgets |

## Authentication and invites

**Sign-in.** Supabase Auth with two entry points: Google, and an emailed 6-digit code. The same email also carries a link that lands on `/auth/callback`. Server actions make the auth calls (`signInWithOAuth` with `skipBrowserRedirect` returns the provider URL, `verifyOtp` checks the code), and `@supabase/ssr` keeps the session in cookies. The email form gives the same response whether or not an address has an account, and the code step has a resend button that is disabled for 60 seconds.

**Where every sign-in ends.** `/auth/callback` (links and Google) and the code form both hand over to `/auth/continue`, which verifies the user with the auth server, then in order:
1. sends users without a display name to `/welcome`;
2. redeems the pending invite, if there is one;
3. continues to the requested page, or the trip list.

**Onboarding.** A display name is required. New profiles start with an empty name (or the name the identity provider supplied), and every protected page checks on the server that the name is set before it renders.

**Proxy.** `src/proxy.ts` refreshes the session cookies on each matched request and redirects signed-out visitors from protected pages to `/sign-in?next=...`. It is an optimistic check only. Every page and action verifies the user again with `getUser()`, and row-level security backs all data access. The public paths are `/`, `/sign-in`, `/auth/callback`, `/auth/continue`, `/invite-invalid` and `/join/*`.

**Redirect safety.** Every `next` value passes through `safeNextPath`, which accepts only same-site paths: it rejects control characters, whitespace, backslashes and anything that resolves to another origin, and returns the normalized path, query and hash.

**Invite links.** `/join/[token]` works signed out. The `invite_preview` SQL function (security definer, callable by anon) returns only the trip name, the inviter's display name and the member count for a live link. Unknown, expired, revoked and malformed tokens all return the same empty result. The proxy stores the token in a `layover_pending_invite` cookie (httpOnly, SameSite=Lax, Secure in production, one hour), so the token never appears in a `next` parameter or an email redirect. Joining always requires an explicit confirmation, and no GET request changes membership. Opening a link, signing in, and `/auth/continue` only read the cookie and send the user to `/join/confirm`, which shows the same three-field preview with "Join trip" and "Not now" buttons. "Join trip" is a POST server action (Next.js checks the request origin) that redeems the cookie once through `join_with_invite`, clears it whatever the outcome, and lands on the trip. "Not now" clears the cookie without joining. Someone who is already a member goes straight to the trip, checked by `invite_trip_if_member`, which returns a trip id only to a member holding a live link. A link that no longer works shows one neutral message and the cookie is cleared.

**Sessions.** Sign-out ends the session on the current device only.

## Route engine

1. **Validate hard constraints first.** Fixed events pin a city to specific nights, which anchors the sequence.
2. **Search exactly, with pruning.** Every subset and ordering of candidate cities is explored, but partial routes that can't fit the date window, a fixed event or minimum stays are dropped early. Candidate cities are capped at 8, and larger inputs are rejected with a clear message.
3. **Allocate nights.** A dynamic program over (position, nights used) decides whether any valid split exists. Spare nights then go to the cities the group wants most.
4. **Memoize by an order-invariant key.** The night split depends on route order only through the fixed-event cities, so routes share results through a key built from the route split at event cities. A test at the 8-city cap asserts that allocation runs stay under 1% of the orderings evaluated.
5. **Score each route as a vector,** not one opaque number: cost per traveler, group total, travel time, transfers and satisfaction.
6. **Keep the Pareto front** (routes no other route beats on every measure), using a sort-and-sweep, then label meaningfully different options: cheapest, most wanted, least travel.
7. **Estimate unpriced legs.** A city pair with no quote gets a distance-based estimate labeled `estimate`, so it can be compared without being treated as impossible.

**Simulation.** The engine can rerun a route without a city and compare the result with the original.

**Saved scenarios.** `runScenario` builds the engine input from the trip's stored destinations, constraints, availability and unexpired quotes, hashes it, runs the engine and stores the result in `route_scenarios`. The same input and engine version reuse the saved row. Budgets are not part of that input, so saved results visible to the group never carry headroom.

Exact search over a capped set is exact and easy to explain. Heuristics like beam search scale further but lose the guarantee that a feasible route is always found.

## Budget privacy

- `member_budgets` is readable only by its owner, enforced by row-level security. It holds the exact amount the traveler typed (`ceiling_minor`); `band` is derived from it by a database trigger, so the two cannot disagree.
- The rest of the trip sees only the band (under 2,000, 2,000 to 3,000, 3,000 to 4,000, 4,000 or more in the trip currency), through the `trip_member_bands(trip_id)` function. It is security definer, returns member and band only, never the amount, and returns nothing to anyone who is not a member of that trip.
- When a traveler ceiling is supplied, the engine rejects any route that puts that traveler over it and reports only counts by reason, with no names or amounts.
- Each engine result type has a redaction function that strips headroom for everyone but its owner, because headroom plus cost would reveal another traveler's ceiling.
- The saved-scenario flow never reads budgets.

## Pricing

- **Storage:** quotes are stored per trip with the leg or long-haul fare they cover, amount in minor units, currency, adults, source, provider, fetched time and expiry.
- **Sources:** live (a flight API), manual (entered by the coordinator), estimate (a distance heuristic) and synthetic (placeholder data). Lodging and daily costs have no data source and enter the engine as zero, labeled synthetic.
- **Labels:** every quote carries its source and age, and estimates and synthetic prices are never labeled as live.
- **Verification:** every provider response is checked against the request that produced it: schema, echoed parameters, airports, dates and duration arithmetic. A failed response becomes a missing price, never a zero, and a bad option is dropped without losing the rest of its response.
- **Suspicious prices:** a price far below its own response or similar routes is held out of route generation until a person confirms it, because a false low price would otherwise win "cheapest" on its own. High prices are used with a warning. Prices are never edited.
- **Expiry:** quotes past their expiry, in another currency, or for other than one adult are left out of the engine input and reported.
- **Cost controls:** provider responses are cached on disk and expire after 24 hours, and each run has a hard limit on paid searches.

## Portability

Leaving Vercel or Supabase should take days, not a rewrite.

- Only `src/server/` and `src/db/` import `@supabase/*`. The UI and `domain/` never touch the database client.
- Row-level security policies call one helper (`app.current_user_id()`), so replacing Supabase Auth means changing one function.
- Every schema change is a migration file. There are no dashboard edits.
- No Vercel-only runtime services; the app runs under `next start` on any Node host.
