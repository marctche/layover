# Layover: Architecture

## Stack

| Concern | Choice | Notes |
|---|---|---|
| App | Next.js (App Router), React, TypeScript, Tailwind | One deployable app, with no separate backend service |
| Server logic | Server actions and route handlers, Zod at every boundary | |
| Data and auth | Supabase Postgres, Supabase Auth, row-level security | Migrations live in `supabase/migrations` |
| AI | Claude API through the Anthropic TypeScript SDK | Own tool-calling loop, so the orchestration is explicit |
| Tests | Vitest (unit and integration), Playwright for critical flows | |
| Deploy | Vercel and Supabase | |

## Module layout

```
src/
  app/            Next.js routes, layouts, server actions (thin: parse, authorize, call services)
  components/     UI
  server/         Application services: trips, membership, preferences, proposals,
                  approvals, history. Owns authorization checks and database access.
  domain/         Pure TypeScript: no I/O, no Next.js or Supabase imports
    dates/        UTC date and night arithmetic
    money/        Integer minor units, currency-safe arithmetic, formatting
    trip/         Trip input types: cities, legs, travelers, events, preferences
    engine/       Validation, route search, night allocation, costs, Pareto selection,
                  route comparison, add/remove simulation, per-viewer redaction
  pricing/        Provider interface and implementations, quote cache and freshness rules
  ai/             Tool definitions (thin wrappers over server/ and domain/), Zod schemas,
                  orchestration loop, prompts
  db/             Supabase clients and generated types
supabase/
  migrations/     Schema, row-level security policies, SQL functions
tests/
  fixtures/       The Asia trip scenario
```

**Why `domain/` is pure:** the route, constraint and cost logic is the part that must be correct and defensible. With no I/O it is:
- fast to unit test;
- reusable from both server actions and AI tools;
- impossible for the language model to bypass.

## Data model

| Table | Holds |
|---|---|
| `profiles` | One per auth user: display name (empty until the user sets it, or taken from the identity provider). Visible to the user and to people who share a trip with them |
| `trips` | Name, date window, status, group target budget (a shared benchmark), base currency (always chosen explicitly) |
| `trip_members` | Trip, user, role (`coordinator` or `member`), home airport. Rows are created and ended only by the `create_trip`, `join_with_invite` and `remove_member` SQL functions, never by direct insert or delete. Removal is coordinator-only and takes the member's preferences and budget with it |
| `invitations` | Trip, SHA-256 of a 256-bit token (the token itself is never stored), expiry, revoked_at. A reusable link: anyone holding it can join until it expires or is revoked. A member's row records the link they used (`joined_via`) |
| `destinations` | Trip-scoped candidate cities, suggested_by (kept if the suggester is later removed) |
| `destination_preferences` | Member, destination, score from -2 to 2. Visible to every member, writable by its owner |
| `constraints` | Typed rows: fixed event at a city on dates, minimum stay, member availability window |
| `member_budgets` | Member, ceiling in minor units. **Readable by its owner only.** Never joined into group-visible queries |
| `quotes` | Origin, destination, mode, date, amount in minor units, currency, source, provider, fetched_at, expires_at |
| `route_scenarios` | Computed candidates, keyed by a hash of their inputs so results are cached and reproducible |
| `decision_cards`, `card_responses` | Trigger type, supporting facts (schema-validated JSON), generated question and options, status |
| `proposals`, `proposal_versions`, `approvals` | A unique (proposal_version, member) key prevents duplicate approvals. State transitions run in a single SQL function or transaction |
| `itineraries` | Approved versions, immutable once approved |

## Authentication and invites

**Sign-in.** Supabase Auth with two entry points: Google, and an emailed 6-digit code. The same email also carries a link that lands on `/auth/callback`. Server actions make the auth calls (`signInWithOAuth` with `skipBrowserRedirect` returns the provider URL, `verifyOtp` checks the code), and `@supabase/ssr` keeps the session in cookies. The email form gives the same response whether or not an address has an account, and the code step has a resend button that is disabled for 60 seconds.

**Where every sign-in ends.** `/auth/callback` (links and Google) and the code form both hand over to `/auth/continue`, which verifies the user with the auth server, then in order:
1. sends users without a display name to `/welcome`;
2. redeems the pending invite, if there is one;
3. continues to the requested page, or the trip list.

**Onboarding.** A display name is required. New profiles start with an empty name (or the name the identity provider supplied), and every protected page checks on the server that the name is set before it renders.

**Proxy.** `src/proxy.ts` refreshes the session cookies on each matched request and redirects signed-out visitors from protected pages to `/sign-in?next=...`. It is an optimistic check only. Every page and action verifies the user again with `getUser()`, and row-level security backs all data access. The public paths are `/`, `/sign-in`, `/auth/callback`, `/auth/continue`, `/invite-invalid` and `/join/*`.

**Redirect safety.** Every `next` value passes through `safeNextPath`, which accepts only same-site paths: it rejects control characters, whitespace, backslashes and anything that resolves to another origin, and returns the normalized path, query and hash.

**Invite links.** `/join/[token]` works signed out. The `invite_preview` SQL function (security definer, callable by anon) returns only the trip name, the inviter's display name and the member count for a live link. Unknown, expired, revoked and malformed tokens all return the same empty result. The proxy stores the token in a `layover_pending_invite` cookie (httpOnly, SameSite=Lax, Secure in production, one hour), so the token never appears in a `next` parameter or an email redirect. After sign-in, `/auth/continue` redeems the cookie once through `join_with_invite`, clears it whatever the outcome, and lands on the trip. A link that no longer works shows one neutral message.

**Sessions.** Sign-out ends the session on the current device only.

## Route engine

1. **Validate hard constraints first.** Fixed events pin a city to specific nights, which anchors the sequence.
2. **Search exactly, with pruning.** Every subset and ordering of candidate cities is explored, but partial routes that can't fit the date window, a fixed event or minimum stays are dropped early. Candidate cities are capped at 8, and larger inputs are rejected with a clear message.
3. **Allocate nights.** A dynamic program over (position, nights used) decides whether any valid split exists. Spare nights then go to the cities the group wants most.
4. **Memoize by an order-invariant key.** The night split depends on route order only through the fixed-event cities, so routes share results through a key built from the route split at event cities. This cuts the 8-city worst case from about 110,000 allocation runs to 255.
5. **Score each route as a vector,** not one opaque number: cost per traveler, group total, travel time, transfers and satisfaction.
6. **Keep the Pareto front** (routes no other route beats on every measure), using a sort-and-sweep, then label meaningfully different options: cheapest, most wanted, least travel.
7. **Price only the finalists.** Live quotes are fetched after pruning, which keeps provider calls low.

Exact search over a capped set is exact and easy to explain. Heuristics like beam search scale further but lose the guarantee that a feasible route is always found.

## Budget privacy

- `member_budgets` is readable only by its owner, enforced by row-level security.
- Budget checks run on the server. Each traveler gets their own exact headroom. The group gets at most a count of travelers over budget per route, and only when the group has 3 or more members.
- Every route result is redacted for the person viewing it before it leaves the server, because headroom plus cost would reveal another traveler's ceiling.
- AI tools never receive other members' raw budgets.

## AI orchestration

- **Server-side only:** all Claude calls run on the server, and the model calls narrow tools that wrap `server/` and `domain/` functions.
- **Validated:** tool inputs and model outputs are checked with Zod. Invalid output is retried once, then surfaced as an error.
- **Grounded:** numbers in AI text come from tool results. Decision-card text is generated from a structured facts object, and the card displays the backend's facts, not numbers from the model's text.
- **Untrusted content stays data:** member notes and provider responses are passed as data, never as instructions.

## Pricing

- **Interface:** `getQuote(leg, date) -> Quote | Missing`.
- **Sources:** live (a flight API), manual (entered by members), estimate (a distance and mode heuristic) and synthetic (demo data).
- **Labels:** every quote carries its source and age, and estimates and synthetic prices are never labeled as live.
- **Verification:** every provider response is checked against the request that produced it: schema, echoed parameters, airports, dates and duration arithmetic. A failed response becomes a missing price, never a zero, and a bad option is dropped without losing the rest of its response.
- **Suspicious prices:** a price far below its own response or similar routes is held out of route generation until a person confirms it, because a false low price would otherwise win "cheapest" on its own. High prices are used with a warning. Prices are never edited.
- **Cost controls:** quotes are cached with an expiry per leg type. Duplicate requests are merged, and concurrent provider calls are capped.

## Portability

Leaving Vercel or Supabase should take days, not a rewrite.

- Only `src/server/` and `src/db/` import `@supabase/*`. The UI and `domain/` never touch the database client.
- Row-level security policies call one helper (`app.current_user_id()`), so replacing Supabase Auth means changing one function.
- Every schema change is a migration file. There are no dashboard edits.
- No Vercel-only runtime services; the app runs under `next start` on any Node host.
