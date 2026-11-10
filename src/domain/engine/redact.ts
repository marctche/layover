import type { SimulateResult } from "./simulate";
import type { EngineError, RouteOptionsResult, RoutePlan } from "./types";

// Headroom plus a visible total reveals a traveler's private ceiling, so every
// engine result must pass through one of these before it leaves the server.
// Server code should import these, never return raw engine output.

/** Strips headroom from every entry except the viewer's own. */
export function redactForViewer(route: RoutePlan, viewerId: string): RoutePlan {
  return {
    ...route,
    travelerCosts: route.travelerCosts.map((c) => {
      if (c.travelerId === viewerId) return c;
      const rest = { ...c };
      delete rest.headroom;
      return rest;
    }),
  };
}

function redactErrorForViewer(error: EngineError, viewerId: string): EngineError {
  if (!error.dropOptions) return error;
  return {
    ...error,
    dropOptions: error.dropOptions.map((d) => ({ ...d, cheapest: d.cheapest && redactForViewer(d.cheapest, viewerId) })),
  };
}

export function redactOptionsForViewer(result: RouteOptionsResult, viewerId: string): RouteOptionsResult {
  if (!result.ok) return { ...result, errors: result.errors.map((e) => redactErrorForViewer(e, viewerId)) };
  return {
    ...result,
    alternatives: result.alternatives.map((a) => ({ ...a, route: redactForViewer(a.route, viewerId) })),
  };
}

export function redactSimulationForViewer(result: SimulateResult, viewerId: string): SimulateResult {
  if (!result.ok) return { ...result, errors: result.errors.map((e) => redactErrorForViewer(e, viewerId)) };
  return {
    ...result,
    outcomes: result.outcomes.map((o) => ({
      ...o,
      baseline: o.baseline && redactForViewer(o.baseline, viewerId),
      proposed: o.proposed && redactForViewer(o.proposed, viewerId),
    })),
  };
}
