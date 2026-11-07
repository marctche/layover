import { money, type Money } from "../money/money";
import type { EngineError, RoutePlan, TravelerCost } from "./types";

export interface MoneyDelta {
  /** `to` minus `from`; negative means `to` is cheaper. */
  international: Money;
  intercity: Money;
  lodging: Money;
  daily: Money;
  total: Money;
}

export interface RouteComparison {
  fromId: string;
  toId: string;
  travelerDeltas: { travelerId: string; delta: MoneyDelta }[];
  groupTotalDelta: Money;
  travelMinutesDelta: number;
  transfersDelta: number;
  satisfactionDelta: number;
  nightsByCity: { cityId: string; from: number; to: number; delta: number }[];
  citiesAdded: string[];
  citiesRemoved: string[];
}

export type CompareResult = { ok: true; comparison: RouteComparison } | { ok: false; errors: EngineError[] };

const diff = (b: Money, a: Money) => money(b.amountMinor - a.amountMinor, b.currency);

function deltaFor(a: TravelerCost, b: TravelerCost): MoneyDelta {
  return {
    international: diff(b.international, a.international),
    intercity: diff(b.intercity, a.intercity),
    lodging: diff(b.lodging, a.lodging),
    daily: diff(b.daily, a.daily),
    total: diff(b.total, a.total),
  };
}

/**
 * Deltas are `to - from`. Every figure is derived from the two computed plans.
 * Headroom and ceilings are deliberately not part of the comparison.
 */
export function compareRoutes(from: RoutePlan, to: RoutePlan): CompareResult {
  const fromIds = from.travelerCosts.map((c) => c.travelerId);
  const toIds = to.travelerCosts.map((c) => c.travelerId);
  if (fromIds.length !== toIds.length || fromIds.some((id, i) => id !== toIds[i])) {
    return {
      ok: false,
      errors: [{ code: "traveler_mismatch", message: "Routes were computed for different travelers and cannot be compared" }],
    };
  }

  const nightsOf = (r: RoutePlan, id: string) => r.stops.find((s) => s.cityId === id)?.nights ?? 0;
  const cityIds = [...from.stops.map((s) => s.cityId)];
  for (const s of to.stops) if (!cityIds.includes(s.cityId)) cityIds.push(s.cityId);

  const toCost = new Map(to.travelerCosts.map((c) => [c.travelerId, c]));
  const travelerDeltas = from.travelerCosts.map((a) => {
    const b = toCost.get(a.travelerId);
    if (!b) throw new Error("Invariant violated: traveler missing after id check");
    return { travelerId: a.travelerId, delta: deltaFor(a, b) };
  });

  return {
    ok: true,
    comparison: {
      fromId: from.id,
      toId: to.id,
      travelerDeltas,
      groupTotalDelta: diff(to.metrics.groupTotal, from.metrics.groupTotal),
      travelMinutesDelta: to.metrics.totalTravelMinutes - from.metrics.totalTravelMinutes,
      transfersDelta: to.metrics.transfers - from.metrics.transfers,
      satisfactionDelta: to.metrics.satisfaction - from.metrics.satisfaction,
      nightsByCity: cityIds.map((cityId) => {
        const f = nightsOf(from, cityId);
        const t = nightsOf(to, cityId);
        return { cityId, from: f, to: t, delta: t - f };
      }),
      citiesAdded: to.metrics.citiesIncluded.filter((id) => !from.metrics.citiesIncluded.includes(id)),
      citiesRemoved: from.metrics.citiesIncluded.filter((id) => !to.metrics.citiesIncluded.includes(id)),
    },
  };
}
