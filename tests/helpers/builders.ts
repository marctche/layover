import { money } from "@/domain/money/money";
import type { Leg, LongHaulFare, Quote, TripInput } from "@/domain/trip/types";

export const quote = (dollars: number): Quote => ({ price: money(dollars * 100, "CAD"), source: "synthetic" });

export const leg = (from: string, to: string, minutes: number, dollars: number, mode: Leg["mode"] = "flight"): Leg => ({
  from,
  to,
  mode,
  durationMinutes: minutes,
  pricePerPerson: quote(dollars),
});

/** One ticket covering home > `to` at the start and `from` > home at the end. */
export const fare = (
  home: string,
  to: string,
  from: string,
  outMinutes: number,
  retMinutes: number,
  dollars: number,
  source: Quote["source"] = "synthetic",
): LongHaulFare => ({
  home,
  outboundTo: to,
  returnFrom: from,
  outboundMinutes: outMinutes,
  returnMinutes: retMinutes,
  pricePerPerson: { ...quote(dollars), source },
});

/**
 * Three cities (A, B, C), one traveler T from H, 6 nights, every city 2 to 4
 * nights, intercity legs both ways between all pairs, and NO home legs: callers
 * add one-way home legs and/or fares. Intercity legs are 60 min, 100.00 CAD.
 */
export function triangleTrip(): TripInput {
  const ids = ["A", "B", "C"];
  const legs: Leg[] = [];
  for (const x of ids) for (const y of ids) if (x !== y) legs.push(leg(x, y, 60, 100));
  return {
    currency: "CAD",
    startDate: "2027-06-01",
    endDate: "2027-06-07",
    cities: ids.map((id) => ({ id, name: id, minNights: 2, maxNights: 4 })),
    travelers: [{ id: "T", name: "Solo", home: "H" }],
    legs,
    cityCosts: ids.map((cityId) => ({ cityId, lodgingPerPersonPerNight: quote(80), dailySpendPerPerson: quote(50) })),
    fixedEvents: [],
    preferences: [],
  };
}

/** triangleTrip plus one-way home legs both ways for every city (600 min, 400.00 CAD each). */
export function triangleWithHomeLegs(): TripInput {
  const t = triangleTrip();
  for (const id of ["A", "B", "C"]) t.legs.push(leg("H", id, 600, 400), leg(id, "H", 600, 400));
  return t;
}

/**
 * Two cities (A, B), two travelers (T1 from H1, T2 from H2), 5 nights.
 * Only A -> B exists, so A>B is the sole viable order. Hand-computed totals:
 * T1 1710.00, T2 1930.00 CAD; see costs.test.ts.
 */
export function miniTrip(): TripInput {
  return {
    currency: "CAD",
    startDate: "2027-06-01",
    endDate: "2027-06-06",
    cities: [
      { id: "A", name: "Alpha", minNights: 2, maxNights: 3 },
      { id: "B", name: "Bravo", minNights: 2, maxNights: 3 },
    ],
    travelers: [
      { id: "T1", name: "One", home: "H1" },
      { id: "T2", name: "Two", home: "H2" },
    ],
    legs: [
      leg("H1", "A", 600, 500),
      leg("B", "H1", 620, 520),
      leg("H2", "A", 700, 600),
      leg("B", "H2", 720, 640),
      leg("A", "B", 60, 100),
    ],
    cityCosts: [
      { cityId: "A", lodgingPerPersonPerNight: quote(80), dailySpendPerPerson: quote(50) },
      { cityId: "B", lodgingPerPersonPerNight: quote(60), dailySpendPerPerson: quote(40) },
    ],
    fixedEvents: [],
    preferences: [
      { travelerId: "T1", cityId: "A", score: 2 },
      { travelerId: "T1", cityId: "B", score: -2 },
      { travelerId: "T2", cityId: "A", score: 1 },
      { travelerId: "T2", cityId: "B", score: 1 },
    ],
  };
}

/**
 * One traveler, 6 nights, A required. Home links only into A, so the routes
 * are A>B (4+2 nights) and A>B>C (2+2+2). Hand-computed: 1660.00 vs 1760.00 CAD.
 */
export function chainTrip(): TripInput {
  return {
    currency: "CAD",
    startDate: "2027-06-01",
    endDate: "2027-06-07",
    cities: [
      { id: "A", name: "Alpha", minNights: 2, maxNights: 4 },
      { id: "B", name: "Bravo", minNights: 2, maxNights: 4 },
      { id: "C", name: "Charlie", minNights: 2, maxNights: 2 },
    ],
    travelers: [{ id: "T", name: "Solo", home: "H" }],
    legs: [leg("H", "A", 600, 400), leg("A", "B", 60, 100), leg("B", "C", 90, 150), leg("C", "H", 620, 450), leg("B", "H", 610, 420)],
    cityCosts: [
      { cityId: "A", lodgingPerPersonPerNight: quote(80), dailySpendPerPerson: quote(50) },
      { cityId: "B", lodgingPerPersonPerNight: quote(70), dailySpendPerPerson: quote(40) },
      { cityId: "C", lodgingPerPersonPerNight: quote(60), dailySpendPerPerson: quote(30) },
    ],
    fixedEvents: [],
    preferences: [],
    mustInclude: ["A"],
  };
}
