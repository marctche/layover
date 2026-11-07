import { haversineKm, pathKm, permutations } from "./geo";
import type { Classification, Modifier, PlannerCity, PlannerInput, Shape } from "./types";

export const LONG_HAUL_KM = 3000;
export const LOOP_RATIO = 1.3;
export const CORRIDOR_LINEARITY = 1.25;
export const BORDERLINE_LINEARITY = 1.4;

export function fmtKm(km: number): string {
  return `${Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} km`;
}

/** Cities the user has pinned down in some way; the rest may be dropped from a route. */
export function requiredCityIds(input: PlannerInput): Set<string> {
  const req = new Set<string>(input.mustInclude ?? []);
  for (const id of input.lockedOrder ?? []) req.add(id);
  if (input.startCity) req.add(input.startCity);
  if (input.endCity) req.add(input.endCity);
  for (const e of input.fixedEvents ?? []) req.add(e.cityId);
  return req;
}

export function classify(input: PlannerInput): Classification {
  const cities = input.cities;
  const n = cities.length;
  const cityById = new Map<string, PlannerCity>(cities.map((c) => [c.id, c]));
  const reasons: string[] = [];

  let homeToNearestCityKm = n === 0 ? 0 : Infinity;
  for (const c of cities) homeToNearestCityKm = Math.min(homeToNearestCityKm, haversineKm(input.home, c));
  const longHaul = n > 0 && homeToNearestCityKm > LONG_HAUL_KM;
  reasons.push(
    longHaul
      ? `long haul: nearest city is ${fmtKm(homeToNearestCityKm)} from home (threshold ${fmtKm(LONG_HAUL_KM)})`
      : `not long haul: nearest city is ${fmtKm(homeToNearestCityKm)} from home (threshold ${fmtKm(LONG_HAUL_KM)})`,
  );

  let maxPairKm = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      maxPairKm = Math.max(maxPairKm, haversineKm(cities[i] as PlannerCity, cities[j] as PlannerCity));
    }
  }

  let shortestOpenPathKm = 0;
  let closedTourKm = 0;
  if (n > 1) {
    shortestOpenPathKm = Infinity;
    closedTourKm = Infinity;
    for (const order of permutations(cities.map((c) => c.id))) {
      const open = pathKm(order, cityById);
      const back = haversineKm(cityById.get(order[n - 1] as string) as PlannerCity, cityById.get(order[0] as string) as PlannerCity);
      if (open < shortestOpenPathKm) shortestOpenPathKm = open;
      if (open + back < closedTourKm) closedTourKm = open + back;
    }
  }

  const linearity = n <= 2 || maxPairKm === 0 ? 1 : shortestOpenPathKm / maxPairKm;
  const linText = `linearity ${linearity.toFixed(2)} (shortest path ${fmtKm(shortestOpenPathKm)} / widest pair ${fmtKm(maxPairKm)})`;

  let shape: Shape;
  if (n >= 3 && closedTourKm <= LOOP_RATIO * shortestOpenPathKm) {
    shape = "loop";
    reasons.push(
      `loop: closed tour ${fmtKm(closedTourKm)} is within ${LOOP_RATIO}x of the shortest open path ${fmtKm(shortestOpenPathKm)}; returning to the first city needs a ground leg the engine does not model yet`,
    );
  } else if (linearity <= CORRIDOR_LINEARITY) {
    shape = "corridor";
    reasons.push(`corridor: ${linText} is at most ${CORRIDOR_LINEARITY}`);
  } else {
    shape = "cluster";
    reasons.push(`cluster: ${linText} is above ${CORRIDOR_LINEARITY}`);
    if (linearity <= BORDERLINE_LINEARITY) {
      reasons.push("between corridor and cluster; chose cluster because it searches more");
    }
  }

  const modifiers: Modifier[] = [];
  const events = input.fixedEvents ?? [];
  if (events.length > 0) {
    modifiers.push("anchored");
    reasons.push(`anchored: ${events.length} fixed event(s) pin the schedule`);
  }
  const locked = input.lockedOrder ?? [];
  if (cities.every((c) => locked.includes(c.id)) && n > 0) {
    modifiers.push("mostly_locked");
    reasons.push("mostly locked: the locked order covers every city");
  } else if (input.startCity && input.endCity && n <= 3) {
    modifiers.push("mostly_locked");
    reasons.push(`mostly locked: start and end cities are set and there are only ${n} cities`);
  }
  const required = requiredCityIds(input);
  const optional = cities.filter((c) => !required.has(c.id));
  if (optional.length > 0) {
    modifiers.push("wide_open");
    reasons.push(`wide open: ${optional.length} of ${n} cities are not required and may be dropped`);
  }
  if (n >= 6) {
    modifiers.push("large");
    reasons.push(`large: ${n} cities (6 or more); orders are filtered more tightly`);
  }

  return {
    shape,
    modifiers,
    longHaul,
    features: { cityCount: n, homeToNearestCityKm, shortestOpenPathKm, maxPairKm, linearity, closedTourKm },
    reasons,
  };
}
