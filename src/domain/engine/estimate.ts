import { money, minorUnitDigits, type CurrencyCode } from "../money/money";
import { haversineKm } from "../planner/geo";
import type { Leg } from "../trip/types";

/**
 * Distance-based leg estimates. Every constant below is a HEURISTIC, not a quote:
 * it exists so an unpriced pair can be compared and labeled "estimate" instead of
 * being treated as impossible. Prices lean high so an estimate rarely hides a
 * budget problem. Amounts are in major units of the trip currency and assume a
 * roughly dollar-scale currency; there is no currency conversion in the engine.
 */
export const ESTIMATE = {
  provider: "distance-heuristic",
  /** Straight-line distance below which the estimate is ground transport. */
  groundMaxKm: 600,
  /** Road and rail routes are longer than the great circle. */
  groundDetourFactor: 1.3,
  groundKmPerHour: 80,
  groundFixedMinutes: 30,
  /** Per-person price: base plus per-km, major units. */
  groundBase: 15,
  groundPerKm: 0.2,
  /** Includes airport transfers, check-in and security on top of block time. */
  flightFixedMinutes: 180,
  flightKmPerHour: 750,
  flightBase: 90,
  flightPerKm: 0.12,
} as const;

export interface Located {
  lat: number;
  lng: number;
}

/** Deterministic estimate for a directed pair. Duration and price both grow with distance. */
export function estimateLeg(from: Located & { id: string }, to: Located & { id: string }, currency: CurrencyCode): Leg {
  const km = haversineKm(from, to);
  const ground = km < ESTIMATE.groundMaxKm;
  const durationMinutes = ground
    ? Math.round(ESTIMATE.groundFixedMinutes + ((km * ESTIMATE.groundDetourFactor) / ESTIMATE.groundKmPerHour) * 60)
    : Math.round(ESTIMATE.flightFixedMinutes + (km / ESTIMATE.flightKmPerHour) * 60);
  const major = ground ? ESTIMATE.groundBase + km * ESTIMATE.groundPerKm : ESTIMATE.flightBase + km * ESTIMATE.flightPerKm;
  const minor = Math.round(major * 10 ** minorUnitDigits(currency));
  return {
    from: from.id,
    to: to.id,
    mode: ground ? "train" : "flight",
    durationMinutes: Math.max(1, durationMinutes),
    pricePerPerson: { price: money(minor, currency), source: "estimate", provider: ESTIMATE.provider },
  };
}
