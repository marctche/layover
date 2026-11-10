import { validateInput } from "./validate";
import { searchRoutes } from "./route-search";
import { bestFor, DEFAULT_MAX_ALTERNATIVES, paretoFront, pickAlternatives } from "./select";
import { withoutCity } from "./simulate";
import type { DropOption, RouteOptionsResult } from "./types";
import type { TripInput } from "../trip/types";

/**
 * Explains an infeasible required set: for each required city that nothing locks in place,
 * rerun the search without it. Subset search is used only here, never to choose routes.
 */
function computeDropOptions(input: TripInput): DropOption[] {
  const locked = new Set<string>([
    ...input.fixedEvents.map((e) => e.cityId),
    ...(input.lockedOrder ?? []),
    ...(input.startCity ? [input.startCity] : []),
    ...(input.endCity ? [input.endCity] : []),
  ]);
  return (input.mustInclude ?? [])
    .filter((id) => !locked.has(id))
    .map((cityId): DropOption => {
      const { routes } = searchRoutes(withoutCity(input, cityId));
      return { cityId, feasibleCount: routes.length, cheapest: bestFor("cheapest", routes) };
    });
}

export function generateRouteOptions(input: TripInput): RouteOptionsResult {
  const errors = validateInput(input);
  if (errors.length > 0) return { ok: false, errors };

  const { routes, rejections, stats } = searchRoutes(input);
  if (routes.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "no_feasible_route",
          message: "No route satisfies every hard constraint. See rejections for the reasons and counts.",
          rejections,
          dropOptions: computeDropOptions(input),
        },
      ],
    };
  }

  const front = paretoFront(routes);
  return {
    ok: true,
    alternatives: pickAlternatives(front, input.maxAlternatives ?? DEFAULT_MAX_ALTERNATIVES),
    feasibleCount: routes.length,
    paretoCount: front.length,
    rejections,
    stats,
  };
}
