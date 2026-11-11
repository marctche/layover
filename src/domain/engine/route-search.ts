import { dateOfNight, nightIndexOf, nightsBetween } from "../dates/dates";
import { sumMoney } from "../money/money";
import type { Leg, Quote, TripInput } from "../trip/types";
import { estimateLeg } from "./estimate";
import { allocateNights, type AllocationEvent } from "./allocate";
import {
  betterInternational,
  computeSatisfaction,
  computeTravelerCosts,
  fareCandidate,
  pairCandidate,
  SOURCE_RANK,
  sortSources,
  type InternationalCandidate,
  type InternationalOption,
} from "./costs";
import type { RejectionReason, RejectionSummary, RoutePlan, Stop } from "./types";
import { must } from "./util";

export function emptyRejections(): RejectionSummary {
  return {
    leg_unavailable: 0,
    leg_unpriced: 0,
    missing_home_leg: 0,
    min_nights_exceeded: 0,
    no_valid_allocation: 0,
    over_budget: 0,
    order_locked: 0,
  };
}

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
// Parsed, not string-compared, so "...00Z", "...00.000Z" and offsets order correctly. Missing or unparseable sorts oldest.
const fetchedMs = (l: Leg) => {
  const t = l.pricePerPerson.fetchedAt === undefined ? Number.NaN : Date.parse(l.pricePerPerson.fetchedAt);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/**
 * Cheapest wins; ties go to shorter, then by mode, then the more trustworthy
 * source, then the newest quote, so the choice never depends on input order.
 */
export function cheaperLeg(a: Leg, b: Leg): Leg {
  const d =
    a.pricePerPerson.price.amountMinor - b.pricePerPerson.price.amountMinor ||
    a.durationMinutes - b.durationMinutes ||
    cmp(a.mode, b.mode) ||
    SOURCE_RANK[a.pricePerPerson.source] - SOURCE_RANK[b.pricePerPerson.source] ||
    fetchedMs(b) - fetchedMs(a);
  return d <= 0 ? a : b;
}

/**
 * Enumerates every ordered subset of cities that includes all required
 * cities, pruning early, and returns each feasible, in-budget plan.
 * Input must already have passed validateInput.
 */
export interface SearchStats {
  /** Complete orderings that reached allocation. */
  sequencesEvaluated: number;
  /** Allocation DP runs actually performed (cache misses). */
  allocationRuns: number;
}

export function searchRoutes(input: TripInput): { routes: RoutePlan[]; rejections: RejectionSummary; stats: SearchStats } {
  const total = nightsBetween(input.startDate, input.endDate);
  const cities = input.cities;
  const cityById = new Map(cities.map((c) => [c.id, c]));

  // When several modes serve the same pair, the cheapest wins (v1 limitation).
  const legs = new Map<string, Leg>();
  for (const l of input.legs) {
    if (l.from === l.to) continue;
    const key = `${l.from}\u0000${l.to}`;
    const prev = legs.get(key);
    legs.set(key, prev ? cheaperLeg(prev, l) : l);
  }
  const leg = (from: string, to: string) => legs.get(`${from}\u0000${to}`);

  // Pairs searched and confirmed to have no service. A priced leg always wins over this.
  const unavailable = new Set((input.unavailablePairs ?? []).map((p) => `${p.from}\u0000${p.to}`));
  const located = (id: string) => {
    const c = cityById.get(id);
    return c && c.lat !== undefined && c.lng !== undefined ? { id, lat: c.lat, lng: c.lng } : undefined;
  };
  const estimates = new Map<string, Leg | null>();
  type Resolved = { leg: Leg; estimated: boolean } | "unavailable" | "unpriced";
  /** Intercity leg: priced, else unavailable, else estimated from coordinates, else unpriced. */
  const resolveIntercity = (from: string, to: string): Resolved => {
    const priced = leg(from, to);
    if (priced) return { leg: priced, estimated: false };
    const key = `${from}\u0000${to}`;
    if (unavailable.has(key)) return "unavailable";
    let est = estimates.get(key);
    if (est === undefined) {
      const a = located(from);
      const b = located(to);
      est = a && b ? estimateLeg(a, b, input.currency) : null;
      estimates.set(key, est);
    }
    return est ? { leg: est, estimated: true } : "unpriced";
  };

  // Fares reduced per (home, outboundTo, returnFrom) with the same order as the
  // final choice, so duplicates never depend on input order.
  const fares = new Map<string, InternationalCandidate>();
  const fareOutbound = new Set<string>();
  for (const f of input.longHaulFares ?? []) {
    const key = JSON.stringify([f.home, f.outboundTo, f.returnFrom]);
    const cand = fareCandidate(f);
    const prev = fares.get(key);
    fares.set(key, prev ? betterInternational(prev, cand) : cand);
    fareOutbound.add(JSON.stringify([f.home, f.outboundTo]));
  }

  const lodging = new Map<string, Quote>(input.cityCosts.map((c) => [c.cityId, c.lodgingPerPersonPerNight]));
  const daily = new Map<string, Quote>(input.cityCosts.map((c) => [c.cityId, c.dailySpendPerPerson]));

  const weight = new Map<string, number>();
  for (const p of input.preferences) weight.set(p.cityId, (weight.get(p.cityId) ?? 0) + p.score);

  const events: AllocationEvent[] = input.fixedEvents.map((e) => ({
    cityId: e.cityId,
    firstNight: nightIndexOf(input.startDate, e.startDate),
    lastNight: nightIndexOf(input.startDate, e.endDate),
  }));
  const lockedOrder = input.lockedOrder ?? [];
  const lockIndex = new Map(lockedOrder.map((id, i) => [id, i]));
  const { startCity, endCity } = input;
  const required = new Set<string>([
    ...input.fixedEvents.map((e) => e.cityId),
    ...(input.mustInclude ?? []),
    ...(input.accepted ?? []),
    ...lockedOrder,
    ...(startCity !== undefined ? [startCity] : []),
    ...(endCity !== undefined ? [endCity] : []),
  ]);

  const dateTable = Array.from({ length: total + 1 }, (_, i) => dateOfNight(input.startDate, i));
  const dateAt = (i: number) => must(dateTable[i], "date");

  const rejections = emptyRejections();
  const reject = (r: RejectionReason) => {
    rejections[r] += 1;
  };
  const routes: RoutePlan[] = [];
  const travelerIds = input.travelers.map((t) => t.id);

  // Reachable at trip start by a one-way leg or by any fare flying into the city.
  const canFlyOutTo = (cityId: string) =>
    input.travelers.every(
      (t) => leg(t.home, cityId) !== undefined || fareOutbound.has(JSON.stringify([t.home, cityId])),
    );

  // Best way for one home to fly into `first` and out of `last`; cached per triple.
  const intlCache = new Map<string, InternationalOption | null>();
  const internationalFor = (home: string, first: string, last: string): InternationalOption | null => {
    const key = JSON.stringify([home, first, last]);
    const hit = intlCache.get(key);
    if (hit !== undefined) return hit;
    const out = leg(home, first);
    const back = leg(last, home);
    const pair = out && back ? pairCandidate(out, back) : undefined;
    const fare = fares.get(key);
    const best = pair && fare ? betterInternational(fare, pair) : (fare ?? pair);
    const result: InternationalOption | null = best
      ? {
          priceMinor: best.priceMinor,
          outboundMinutes: best.outboundMinutes,
          returnMinutes: best.returnMinutes,
          sources: best.sources,
          ticket: best.ticket,
        }
      : null;
    intlCache.set(key, result);
    return result;
  };

  // Allocation depends on order only through event coverage, so orderings that
  // differ by permuting non-event cities between event cities share one result.
  // The cache lives for this call only; the domain layer keeps no module state.
  const eventCities = new Set(events.map((e) => e.cityId));
  const stats: SearchStats = { sequencesEvaluated: 0, allocationRuns: 0 };
  const allocCache = new Map<string, Map<string, number> | null>();
  const allocate = (seq: string[]): number[] | null => {
    // JSON keeps ids intact: joining with a delimiter collides on ids that contain it.
    const parts: (string | string[])[] = [];
    let segment: string[] = [];
    for (const id of seq) {
      if (eventCities.has(id)) {
        parts.push(segment.sort(), id);
        segment = [];
      } else segment.push(id);
    }
    parts.push(segment.sort());
    const key = JSON.stringify(parts);
    let hit = allocCache.get(key);
    if (hit === undefined) {
      stats.allocationRuns += 1;
      const r = allocateNights(
      seq.map((id) => {
        const c = must(cityById.get(id), "city");
        const o: { id: string; minNights: number; maxNights?: number; weight: number } = {
          id,
          minNights: c.minNights,
          weight: weight.get(id) ?? 0,
        };
        if (c.maxNights !== undefined) o.maxNights = c.maxNights;
        return o;
      }),
      total,
      events,
      );
      hit = r.ok ? new Map(seq.map((id, i) => [id, must(r.nights[i], "nights")])) : null;
      allocCache.set(key, hit);
    }
    const cached = hit;
    return cached ? seq.map((id) => must(cached.get(id), "cached nights")) : null;
  };

  const evaluate = (seq: string[]) => {
    const last = must(seq[seq.length - 1], "last city");
    if (endCity !== undefined && last !== endCity) return;
    const first = must(seq[0], "first city");
    const international = new Map<string, InternationalOption>();
    for (const t of input.travelers) {
      const opt = internationalFor(t.home, first, last);
      if (!opt) return reject("missing_home_leg");
      international.set(t.id, opt);
    }
    stats.sequencesEvaluated += 1;

    const allocated = allocate(seq);
    if (!allocated) return reject("no_valid_allocation");
    const alloc = { nights: allocated };

    let cursor = 0;
    const stops: Stop[] = seq.map((cityId, i) => {
      const nights = must(alloc.nights[i], "nights");
      const stop: Stop = {
        cityId,
        nights,
        firstNight: cursor,
        checkIn: dateAt(cursor),
        checkOut: dateAt(cursor + nights),
      };
      cursor += nights;
      return stop;
    });

    const resolved = seq.slice(1).map((id, i) => {
      const r = resolveIntercity(must(seq[i], "city"), id);
      if (typeof r === "string") throw new Error("intercity leg unresolved after pruning");
      return { r, from: must(seq[i], "city"), to: id };
    });
    const intercityLegs = resolved.map((x) => x.r.leg);
    const estimatedLegs = resolved.filter((x) => x.r.estimated).map((x) => ({ from: x.from, to: x.to }));

    const travelerCosts = computeTravelerCosts({
      currency: input.currency,
      travelers: input.travelers,
      stops,
      intercityLegs,
      international,
      lodging,
      daily,
    });

    // Budgets are hard. Only a count leaves this function.
    const over = input.travelers.some((t, i) => {
      const c = must(travelerCosts[i], "traveler cost");
      return t.budgetCeiling !== undefined && c.total.amountMinor > t.budgetCeiling.amountMinor;
    });
    if (over) return reject("over_budget");

    const intercityMinutes = intercityLegs.reduce((n, l) => n + l.durationMinutes, 0);
    const intlMinutes = [...international.values()].reduce((n, o) => n + o.outboundMinutes + o.returnMinutes, 0);
    const included = new Set(seq);
    routes.push({
      id: JSON.stringify(seq),
      stops,
      intercityLegs,
      travelerCosts,
      metrics: {
        totalCostPerTraveler: travelerCosts.map((c) => ({ travelerId: c.travelerId, total: c.total })),
        groupTotal: sumMoney(
          travelerCosts.map((c) => c.total),
          input.currency,
        ),
        // Mean international minutes per traveler, rounded: travelers fly different legs.
        totalTravelMinutes: intercityMinutes + Math.round(intlMinutes / input.travelers.length),
        transfers: intercityLegs.length,
        satisfaction: computeSatisfaction(input.preferences, travelerIds, stops),
        citiesIncluded: [...seq],
        citiesExcluded: cities.filter((c) => !included.has(c.id)).map((c) => c.id),
        estimatedLegs,
        priceSources: sortSources(travelerCosts.flatMap((c) => c.priceSources)),
      },
    });
  };

  const minOf = (id: string) => must(cityById.get(id), "city").minNights;

  const inSeq = new Set<string>();
  const extend = (seq: string[], usedMin: number, requiredPlaced: number) => {
    if (seq.length > 0 && requiredPlaced === required.size) evaluate(seq);
    const prev = seq[seq.length - 1];
    // The end city is last by definition: nothing may follow it.
    if (prev !== undefined && prev === endCity) {
      if (seq.length < cities.length) reject("order_locked");
      return;
    }
    for (const c of cities) {
      if (inSeq.has(c.id)) continue;
      if (prev === undefined && startCity !== undefined && c.id !== startCity) {
        reject("order_locked");
        continue;
      }
      const lockAt = lockIndex.get(c.id);
      if (lockAt !== undefined && lockAt > 0 && !inSeq.has(must(lockedOrder[lockAt - 1], "locked predecessor"))) {
        reject("order_locked");
        continue;
      }
      if (prev !== undefined) {
        const r = resolveIntercity(prev, c.id);
        if (r === "unavailable") {
          reject("leg_unavailable");
          continue;
        }
        if (r === "unpriced") {
          reject("leg_unpriced");
          continue;
        }
      }
      if (prev === undefined && !canFlyOutTo(c.id)) {
        reject("missing_home_leg");
        continue;
      }
      // Required cities not yet placed must still fit, so count their minimums too.
      let floor = usedMin + c.minNights;
      for (const id of required) if (id !== c.id && !inSeq.has(id)) floor += minOf(id);
      if (floor > total) {
        reject("min_nights_exceeded");
        continue;
      }
      inSeq.add(c.id);
      seq.push(c.id);
      extend(seq, usedMin + c.minNights, requiredPlaced + (required.has(c.id) ? 1 : 0));
      seq.pop();
      inSeq.delete(c.id);
    }
  };
  extend([], 0, 0);

  return { routes, rejections, stats };
}
