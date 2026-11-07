import type { TripInput } from "../trip/types";
import { compareRoutes, type RouteComparison } from "./compare";
import { searchRoutes } from "./route-search";
import { bestFor, OBJECTIVES, type Objective } from "./select";
import type { EngineError, RoutePlan } from "./types";
import { validateInput } from "./validate";

export interface CityChange {
  type: "add" | "remove";
  cityId: string;
}

export interface ObjectiveOutcome {
  objective: Objective;
  /** Best route under this objective before the change; null if none feasible. */
  baseline: RoutePlan | null;
  proposed: RoutePlan | null;
  /** baseline to proposed; null when either side has no feasible route. */
  comparison: RouteComparison | null;
}

export type SimulateResult =
  | {
      ok: true;
      change: CityChange;
      baselineFeasibleCount: number;
      proposedFeasibleCount: number;
      outcomes: ObjectiveOutcome[];
    }
  | { ok: false; errors: EngineError[] };

function withoutCity(input: TripInput, cityId: string): TripInput {
  const keepEnd = (id: string) => id !== cityId;
  return {
    ...input,
    cities: input.cities.filter((c) => keepEnd(c.id)),
    legs: input.legs.filter((l) => keepEnd(l.from) && keepEnd(l.to)),
    longHaulFares: (input.longHaulFares ?? []).filter((f) => keepEnd(f.outboundTo) && keepEnd(f.returnFrom)),
    cityCosts: input.cityCosts.filter((c) => keepEnd(c.cityId)),
    preferences: input.preferences.filter((p) => keepEnd(p.cityId)),
    mustInclude: (input.mustInclude ?? []).filter(keepEnd),
  };
}

function withCityRequired(input: TripInput, cityId: string): TripInput {
  const must = input.mustInclude ?? [];
  return { ...input, mustInclude: must.includes(cityId) ? must : [...must, cityId] };
}

/**
 * "with" forces the city into every route; "without" removes it from the
 * candidate set. For "add" the baseline is without and the proposal is with;
 * "remove" is the reverse.
 */
export function simulateChange(input: TripInput, change: CityChange): SimulateResult {
  const errors = validateInput(input);
  if (errors.length > 0) return { ok: false, errors };

  const city = input.cities.find((c) => c.id === change.cityId);
  if (!city) {
    return { ok: false, errors: [{ code: "unknown_city", message: `Unknown city "${change.cityId}"`, path: "cityId" }] };
  }

  const events = input.fixedEvents.filter((e) => e.cityId === city.id);
  const pinned = (input.mustInclude ?? []).includes(city.id);
  const lockReasons = [
    ...((input.lockedOrder ?? []).includes(city.id) ? ["it is in lockedOrder"] : []),
    ...(input.startCity === city.id ? ["it is the locked startCity"] : []),
    ...(input.endCity === city.id ? ["it is the locked endCity"] : []),
  ];
  if (events.length > 0 || pinned || lockReasons.length > 0) {
    const why = [
      ...events.map((e) => `fixed event "${e.label}" (${e.startDate} to ${e.endDate})`),
      ...(pinned ? ["it is in mustInclude"] : []),
      ...lockReasons,
    ].join(" and ");
    const message =
      change.type === "remove"
        ? `Cannot remove ${city.name}: ${why} requires the group to be there.`
        : `${city.name} is already in every route: ${why}.`;
    return { ok: false, errors: [{ code: "city_required", message, path: "cityId" }] };
  }

  const withInput = withCityRequired(input, city.id);
  const withoutInput = withoutCity(input, city.id);
  const baselineInput = change.type === "add" ? withoutInput : withInput;
  const proposedInput = change.type === "add" ? withInput : withoutInput;

  const baseline = searchRoutes(baselineInput).routes;
  const proposed = searchRoutes(proposedInput).routes;

  const outcomes = OBJECTIVES.map((objective): ObjectiveOutcome => {
    const b = bestFor(objective, baseline);
    const p = bestFor(objective, proposed);
    let comparison: RouteComparison | null = null;
    if (b && p) {
      const result = compareRoutes(b, p);
      if (result.ok) comparison = result.comparison;
    }
    return { objective, baseline: b, proposed: p, comparison };
  });

  return {
    ok: true,
    change,
    baselineFeasibleCount: baseline.length,
    proposedFeasibleCount: proposed.length,
    outcomes,
  };
}
