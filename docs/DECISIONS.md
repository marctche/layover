# Engineering decisions

The key technical decisions behind Layover, with the alternatives that were rejected and why.

## Exact search instead of heuristics

Trips rarely have more than 8 candidate cities. With a cap of 8, an exact search over subsets and orderings, with pruning, is fast enough and can be fully explained: if a valid route exists, the engine finds it.

**Rejected:** beam search and local search. They scale further but lose that guarantee. Inputs above the cap are rejected with a clear message instead of getting slower. Trip length is capped the same way, at 60 nights, because night allocation grows with the square of trip length.

## Order-invariant memoization

At the 8-city cap (8 fully connected cities, 21 nights) the night-allocation step, a dynamic program over position and nights used, would run once for every city ordering, about 110,000 times.

**Insight:** route order only affects the night split through the fixed-event cities. Shuffling the other cities between two events can't change which splits are valid. So the cache key is the route split at the event cities, with each segment as a sorted set.

**Result:** the dynamic program runs a few hundred times instead of once per ordering. The benchmark asserts on the number of runs rather than wall-clock time, so it doesn't fail on slow CI machines.

Two smaller changes support it:
- **Pareto filter:** a sort-and-sweep replaces an O(n²) pairwise check.
- **Costs:** all cost arithmetic is done in whole cents (integers).

## Estimate unpriced legs instead of pruning them

A city pair with no quote is not treated as impossible. The engine uses a deterministic, distance-based estimate labeled `estimate`, and every price carries its source (live, manual, estimate or synthetic), so an estimate is never shown as a live price.

## Verify provider responses

The flight provider is SerpApi (Google Flights). It is scraping-based, so its output is checked rather than trusted: every response is verified against the request that produced it, and a failed response becomes a missing price, never a zero. Prices that look wrong next to their peers are flagged, and a suspiciously low price is held out of the engine until a person confirms it, because a false low price would otherwise win "cheapest". Manual and estimate sources are always available as fallbacks.

## Budgets stay private

- **Exact amount is private:** a traveler's budget is readable only by its owner, enforced by row-level security. A database trigger derives a coarse band from the amount, and the rest of the trip sees only that band, through a security-definer function that returns member and band and never the amount.
- **Engine check:** when a ceiling is supplied, a route that puts a traveler over it is rejected, never quietly allowed through. The rejection report gives only counts by reason, with no names or amounts.
- **Redaction:** remaining budget room plus the route's cost would reveal someone's exact budget, so it is stripped for everyone but the owner. Each engine result type (a route, a set of options, a simulated change) has its own redaction function, tested by scanning the whole serialized result, so no nested route can slip through.

## Database tests in CI instead of locally

Supabase's local stack runs about 10 Docker containers, which is heavy for a modest laptop.

**Decision:**
- **Development:** a hosted Supabase project, with migrations written by hand and pushed with the Supabase CLI.
- **Tests:** database and access-control tests run in GitHub Actions, where the runners start a clean Supabase stack for each run.

## One app with a pure engine

- **One Next.js app, not microservices:** the scope doesn't justify a second service.
- **Pure engine:** the route, constraint and cost logic in `src/domain/` has no database, network or clock access. That makes it fast to test and independent of the framework and the database.
- **Easy to move off the current hosts:** only `src/server` and `src/db` talk to Supabase, security rules go through one login helper, and the app uses no Vercel-only services.
