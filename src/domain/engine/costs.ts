import { money } from "../money/money";
import type { Leg, PriceSource, Preference, Quote, Traveler } from "../trip/types";
import type { Stop, TravelerCost } from "./types";
import { must } from "./util";

/**
 * Extra satisfaction penalty per (traveler, city) pair where the traveler
 * scored the city -2 and it is in the route. Nights-weighted scores alone let
 * a long stay somewhere loved hide a vetoed city; this keeps a strong
 * objection costly even for a one-night visit.
 */
export const VETO_PENALTY = 10;

/**
 * Trust order, most trustworthy first. A Record, so adding a PriceSource is a
 * compile error until it is ranked here; one table serves sorting and ties.
 */
export const SOURCE_RANK: Record<PriceSource, number> = { live: 0, manual: 1, estimate: 2, synthetic: 3 };

/** Distinct sources, most trustworthy first. Never drops a source. */
export function sortSources(sources: Iterable<PriceSource>): PriceSource[] {
  return [...new Set(sources)].sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b]);
}

export interface CostInputs {
  currency: string;
  travelers: readonly Traveler[];
  stops: readonly Stop[];
  intercityLegs: readonly Leg[];
  /** Per traveler id: [home -> first city, last city -> home]. */
  homeLegs: ReadonlyMap<string, readonly [Leg, Leg]>;
  lodging: ReadonlyMap<string, Quote>;
  daily: ReadonlyMap<string, Quote>;
}

export function computeTravelerCosts(c: CostInputs): TravelerCost[] {
  // Integer minor units internally; Money objects are built once per traveler.
  const cur = c.currency;
  const nightsLodging = c.stops.reduce((n, s) => n + must(c.lodging.get(s.cityId), "lodging").price.amountMinor * s.nights, 0);
  const nightsDaily = c.stops.reduce((n, s) => n + must(c.daily.get(s.cityId), "daily").price.amountMinor * s.nights, 0);
  const intercityMinor = c.intercityLegs.reduce((n, l) => n + l.pricePerPerson.price.amountMinor, 0);
  const shared: PriceSource[] = [];
  for (const l of c.intercityLegs) shared.push(l.pricePerPerson.source);
  for (const s of c.stops) shared.push(must(c.lodging.get(s.cityId), "lodging").source, must(c.daily.get(s.cityId), "daily").source);

  return c.travelers.map((t) => {
    const [outbound, inbound] = must(c.homeLegs.get(t.id), `home legs for ${t.id}`);
    const intl = outbound.pricePerPerson.price.amountMinor + inbound.pricePerPerson.price.amountMinor;
    const totalMinor = intl + intercityMinor + nightsLodging + nightsDaily;
    const cost: TravelerCost = {
      travelerId: t.id,
      international: money(intl, cur),
      intercity: money(intercityMinor, cur),
      lodging: money(nightsLodging, cur),
      daily: money(nightsDaily, cur),
      total: money(totalMinor, cur),
      priceSources: sortSources([outbound.pricePerPerson.source, inbound.pricePerPerson.source, ...shared]),
    };
    if (t.budgetCeiling) cost.headroom = money(t.budgetCeiling.amountMinor - totalMinor, cur);
    return cost;
  });
}

/**
 * Sum over travelers and included cities of score * nights, minus
 * VETO_PENALTY per -2 score on an included city. Unscored pairs count as 0.
 */
export function computeSatisfaction(
  preferences: readonly Preference[],
  travelerIds: readonly string[],
  stops: readonly Stop[],
): number {
  const score = new Map<string, number>();
  for (const p of preferences) score.set(`${p.travelerId}\u0000${p.cityId}`, p.score);
  let total = 0;
  for (const t of travelerIds) {
    for (const s of stops) {
      const v = score.get(`${t}\u0000${s.cityId}`) ?? 0;
      total += v * s.nights;
      if (v === -2) total -= VETO_PENALTY;
    }
  }
  return total;
}
