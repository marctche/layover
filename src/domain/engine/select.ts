import type { AlternativeLabel, RouteAlternative, RoutePlan } from "./types";
import { must } from "./util";

export const DEFAULT_MAX_ALTERNATIVES = 3;

const cost = (r: RoutePlan) => r.metrics.groupTotal.amountMinor;
const minutes = (r: RoutePlan) => r.metrics.totalTravelMinutes;
const sat = (r: RoutePlan) => r.metrics.satisfaction;
const byId = (a: RoutePlan, b: RoutePlan) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dominates(a: RoutePlan, b: RoutePlan): boolean {
  const noWorse = cost(a) <= cost(b) && minutes(a) <= minutes(b) && sat(a) >= sat(b);
  const better = cost(a) < cost(b) || minutes(a) < minutes(b) || sat(a) > sat(b);
  return noWorse && better;
}

/**
 * Non-dominated routes on (groupTotal min, travel minutes min, satisfaction max).
 * Sweeps in cost order: any dominator sorts before the route it dominates, so
 * comparing against the front built so far is enough (domination is transitive).
 */
export function paretoFront(routes: readonly RoutePlan[]): RoutePlan[] {
  const sorted = [...routes].sort((a, b) => cost(a) - cost(b) || minutes(a) - minutes(b) || sat(b) - sat(a));
  const front: RoutePlan[] = [];
  for (const r of sorted) if (!front.some((f) => dominates(f, r))) front.push(r);
  return front.sort(byId);
}

export type Objective = "cheapest" | "most_wanted" | "least_travel";

// Each objective's primary key, then deterministic tie-breaks.
const COMPARATORS: Record<Objective, (a: RoutePlan, b: RoutePlan) => number> = {
  cheapest: (a, b) => cost(a) - cost(b) || minutes(a) - minutes(b) || sat(b) - sat(a) || byId(a, b),
  most_wanted: (a, b) => sat(b) - sat(a) || cost(a) - cost(b) || minutes(a) - minutes(b) || byId(a, b),
  least_travel: (a, b) => minutes(a) - minutes(b) || cost(a) - cost(b) || sat(b) - sat(a) || byId(a, b),
};

export const OBJECTIVES: readonly Objective[] = ["cheapest", "most_wanted", "least_travel"];

export function bestFor(objective: Objective, routes: readonly RoutePlan[]): RoutePlan | null {
  if (routes.length === 0) return null;
  return [...routes].sort(COMPARATORS[objective])[0] ?? null;
}

/** How different two plans are: cities, then order, then night counts. */
function distance(a: RoutePlan, b: RoutePlan): number {
  const aIds = a.stops.map((s) => s.cityId);
  const bIds = b.stops.map((s) => s.cityId);
  const symmetric = aIds.filter((x) => !bIds.includes(x)).length + bIds.filter((x) => !aIds.includes(x)).length;
  const sameSet = symmetric === 0;
  const orderDiffers = sameSet && aIds.join() !== bIds.join();
  let nightsDiff = 0;
  for (const s of a.stops) {
    const other = b.stops.find((t) => t.cityId === s.cityId);
    if (other) nightsDiff += Math.abs(other.nights - s.nights);
  }
  return symmetric * 10 + (orderDiffers ? 5 : 0) + nightsDiff;
}

/**
 * Picks up to `max` routes from the Pareto front. Label winners come first
 * (one route can hold several labels), then remaining slots go to the front
 * route most different from everything already chosen.
 */
export function pickAlternatives(front: readonly RoutePlan[], max: number): RouteAlternative[] {
  const chosen: { route: RoutePlan; labels: AlternativeLabel[] }[] = [];
  for (const objective of OBJECTIVES) {
    const winner = bestFor(objective, front);
    if (!winner) continue;
    const existing = chosen.find((c) => c.route.id === winner.id);
    if (existing) existing.labels.push(objective);
    else if (chosen.length < max) chosen.push({ route: winner, labels: [objective] });
  }
  while (chosen.length < max) {
    const rest = front.filter((r) => !chosen.some((c) => c.route.id === r.id));
    if (rest.length === 0) break;
    const scored = rest.map((r) => ({ r, d: Math.min(...chosen.map((c) => distance(c.route, r))) }));
    scored.sort((a, b) => b.d - a.d || cost(a.r) - cost(b.r) || byId(a.r, b.r));
    chosen.push({ route: must(scored[0], "filler").r, labels: ["pareto_alternative"] });
  }
  return chosen;
}
