import { money } from "../money/money";
import type { Leg, LongHaulFare, PriceSource, Preference, Quote, Traveler } from "../trip/types";
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

/** A traveler's chosen way to fly out and home for one (first, last) pair. */
export interface InternationalOption {
  priceMinor: number;
  outboundMinutes: number;
  returnMinutes: number;
  sources: PriceSource[];
  ticket: "one_way_pair" | "fare";
}

/** An option plus the freshness used only to break ties. */
export interface InternationalCandidate extends InternationalOption {
  /** Parsed fetchedAt (a pair uses the older of its two legs); -Infinity when missing. */
  fetchedMs: number;
}

// Parsed, not string-compared. Missing or unparseable sorts oldest.
export const quoteFetchedMs = (q: Quote): number => {
  const t = q.fetchedAt === undefined ? Number.NaN : Date.parse(q.fetchedAt);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

const worstRank = (sources: readonly PriceSource[]) => sources.reduce((n, s) => Math.max(n, SOURCE_RANK[s]), 0);

export function fareCandidate(f: LongHaulFare): InternationalCandidate {
  return {
    priceMinor: f.pricePerPerson.price.amountMinor,
    outboundMinutes: f.outboundMinutes,
    returnMinutes: f.returnMinutes,
    sources: [f.pricePerPerson.source],
    ticket: "fare",
    fetchedMs: quoteFetchedMs(f.pricePerPerson),
  };
}

export function pairCandidate(out: Leg, back: Leg): InternationalCandidate {
  return {
    priceMinor: out.pricePerPerson.price.amountMinor + back.pricePerPerson.price.amountMinor,
    outboundMinutes: out.durationMinutes,
    returnMinutes: back.durationMinutes,
    sources: [out.pricePerPerson.source, back.pricePerPerson.source],
    ticket: "one_way_pair",
    fetchedMs: Math.min(quoteFetchedMs(out.pricePerPerson), quoteFetchedMs(back.pricePerPerson)),
  };
}

/**
 * Negative when `a` is the better international option. Order: lower price,
 * fewer total minutes, fare before one-way pair (one ticket protects the
 * connection), more trustworthy worst source, newest quote. 0 only when every
 * step ties.
 */
export function compareInternational(a: InternationalCandidate, b: InternationalCandidate): number {
  const ticketRank = (t: InternationalCandidate["ticket"]) => (t === "fare" ? 0 : 1);
  const fresh = a.fetchedMs === b.fetchedMs ? 0 : b.fetchedMs > a.fetchedMs ? 1 : -1;
  return (
    a.priceMinor - b.priceMinor ||
    a.outboundMinutes + a.returnMinutes - (b.outboundMinutes + b.returnMinutes) ||
    ticketRank(a.ticket) - ticketRank(b.ticket) ||
    worstRank(a.sources) - worstRank(b.sources) ||
    fresh
  );
}

export function betterInternational(a: InternationalCandidate, b: InternationalCandidate): InternationalCandidate {
  return compareInternational(a, b) <= 0 ? a : b;
}

export interface CostInputs {
  currency: string;
  travelers: readonly Traveler[];
  stops: readonly Stop[];
  intercityLegs: readonly Leg[];
  /** Per traveler id: the chosen international option for this route's first and last city. */
  international: ReadonlyMap<string, InternationalOption>;
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
    const opt = must(c.international.get(t.id), `international option for ${t.id}`);
    const intl = opt.priceMinor;
    const totalMinor = intl + intercityMinor + nightsLodging + nightsDaily;
    const cost: TravelerCost = {
      travelerId: t.id,
      international: money(intl, cur),
      intercity: money(intercityMinor, cur),
      lodging: money(nightsLodging, cur),
      daily: money(nightsDaily, cur),
      total: money(totalMinor, cur),
      internationalTicket: opt.ticket,
      priceSources: sortSources([...opt.sources, ...shared]),
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
