import { validateInput } from "./validate";
import { searchRoutes } from "./route-search";
import { DEFAULT_MAX_ALTERNATIVES, paretoFront, pickAlternatives } from "./select";
import type { RouteOptionsResult } from "./types";
import type { TripInput } from "../trip/types";

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
