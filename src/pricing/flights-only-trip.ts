// Builds an engine input from searched flight prices alone. There is no lodging or
// daily-cost data in a flights-only run, so those costs are zero and labelled synthetic.
import { money } from "@/domain/money/money";
import type { PlannerInput } from "@/domain/planner/types";
import type { CityCosts, Leg, LongHaulFare, Quote, TripInput } from "@/domain/trip/types";
import { CURRENCY } from "./serpapi/client";
import type { Priced } from "./serpapi";

export const FLIGHTS_ONLY_PROVIDER = "flights-only-run";

const noCost = (): Quote => ({ price: money(0, CURRENCY), source: "synthetic", provider: FLIGHTS_ONLY_PROVIDER });

/** `usable` must be the reviewed, unheld prices: held ones never belong in engine input. */
export function buildFlightsOnlyTrip(input: PlannerInput, usable: readonly Priced[]): TripInput {
  const legs: Leg[] = [];
  const longHaulFares: LongHaulFare[] = [];
  for (const p of usable) {
    if (p.kind === "one_way") legs.push(p.leg);
    else longHaulFares.push(p.fare);
  }
  const cityCosts: CityCosts[] = input.cities.map((c) => ({
    cityId: c.id,
    lodgingPerPersonPerNight: noCost(),
    dailySpendPerPerson: noCost(),
  }));

  const trip: TripInput = {
    currency: CURRENCY,
    startDate: input.startDate,
    endDate: input.endDate,
    cities: input.cities.map((c) => (c.maxNights === undefined ? { id: c.id, name: c.name, minNights: c.minNights } : { id: c.id, name: c.name, minNights: c.minNights, maxNights: c.maxNights })),
    travelers: [{ id: "traveler", name: "Traveler", home: input.home.id }],
    legs,
    longHaulFares,
    cityCosts,
    fixedEvents: (input.fixedEvents ?? []).map((e, i) => ({ id: `event-${i + 1}`, cityId: e.cityId, startDate: e.startDate, endDate: e.endDate, label: "Fixed event" })),
    preferences: [],
  };
  if (input.mustInclude) trip.mustInclude = input.mustInclude;
  if (input.lockedOrder) trip.lockedOrder = input.lockedOrder;
  if (input.startCity) trip.startCity = input.startCity;
  if (input.endCity) trip.endCity = input.endCity;
  return trip;
}
