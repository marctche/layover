# Engineering decisions

The key technical decisions behind Layover, with the alternatives that were rejected and why.

## Exact search instead of heuristics

Trips rarely have more than 8 candidate cities. With a cap of 8, an exact search over subsets and orderings, with pruning, is fast enough and can be fully explained: if a valid route exists, the engine finds it.

**Rejected:** beam search and local search. They scale further but lose that guarantee. Inputs above the cap are rejected with a clear message instead of getting slower.

## Order-invariant memoization: worst case from 31 s to 1.5 s

A benchmark at the 8-city cap (8 fully connected cities, 21 nights) took **31 seconds**.

**Cause:** the night-allocation step (a dynamic program over position and nights used) ran once for every city ordering, about 110,000 times.

**Insight:** route order only affects the night split through the fixed-event cities. Shuffling the other cities between two events can't change which splits are valid. So the cache key is the route split at the event cities, with each segment as a sorted set.

**Result:** the dynamic program runs **255 times instead of 109,600**, and the worst case takes about **1.5 s**. The benchmark asserts on the number of runs rather than wall-clock time, so it doesn't fail on slow CI machines.

Two smaller changes support it:
- **Pareto filter:** a sort-and-sweep replaces an O(n²) pairwise check.
- **Costs:** all cost arithmetic is done in whole cents (integers).

## Price only the finalists

A 6-city trip produces hundreds of candidate routes, and each route needs date-specific flight prices. Pricing all of them would mean hundreds of API searches per trip.

**Decision:** routes are ranked using estimated prices, and live prices are fetched only for the 2 or 3 finalists. Every price carries its source (live, manual, estimate or synthetic), so an estimate is never shown as a live price.

## Provider-agnostic pricing

Flight data APIs differ widely in access, cost and coverage:

| Provider | Strengths | Trade-offs |
|---|---|---|
| SerpApi (Google Flights) | Instant access, real prices | Scraping-based, so terms and stability are a risk |
| Duffel | Proper booking API with a clean contract | Live pricing requires business activation and billing |
| RouteStack | Instant signup, free monthly allowance, MCP-first | Unclear token cost and regional coverage |

**Decision:** pricing sits behind one interface, with manual and estimate sources always available as fallbacks. Changing providers doesn't touch the engine or the UI.

## Budgets are hard limits and stay private

- **Hard limits:** a route that puts any traveler over their budget is rejected, never quietly allowed through. The rejection report gives only counts by reason, with no names or amounts.
- **Privacy:** budgets are visible only to their owner. Each traveler sees their own room left in the budget. The group sees only how many travelers are over budget, and only when the group has 3 or more members.
- **Redaction:** every route is redacted for the person viewing it before it leaves the server. Remaining budget room plus the route's cost would reveal someone's exact budget, so it's stripped for everyone but the owner.

## Database tests in CI instead of locally

Supabase's local stack runs about 10 Docker containers, which is heavy for a modest laptop.

**Decision:**
- **Development:** a hosted Supabase project, with migrations written by hand and pushed with the Supabase CLI.
- **Tests:** database and access-control tests run in GitHub Actions, where the runners start a clean Supabase stack for each run.

## One app with a pure engine

- **One Next.js app, not microservices:** the scope doesn't justify a second service.
- **Pure engine:** the route, constraint and cost logic in `src/domain/` has no database, network or clock access. That makes it fast to test, lets both the UI and AI tools reuse it, and means the AI layer can't get around it.
- **Claude API through the Anthropic SDK directly:** with our own tool loop rather than a framework, so the orchestration is explicit and explainable.
- **Easy to move off the current hosts:** only `src/server` and `src/db` talk to Supabase, security rules go through one login helper, and the app uses no Vercel-only services.
