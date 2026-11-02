// SYNTHETIC DEMONSTRATION DATA. Every price, duration and preference below is
// illustrative, not a real quote or a real traveler. All quotes carry source
// "synthetic" and must never be presented as live prices.

import { money } from "@/domain/money/money";
import type { Leg, Preference, Quote, TripInput } from "@/domain/trip/types";

const CAD = "CAD";
const q = (dollars: number): Quote => ({
  price: money(dollars * 100, CAD),
  source: "synthetic",
  provider: "asia-demo",
});

const flight = (from: string, to: string, minutes: number, dollars: number): Leg => ({
  from,
  to,
  mode: "flight",
  durationMinutes: minutes,
  pricePerPerson: q(dollars),
});

/** Both directions at the same price and duration. */
function pair(a: string, b: string, mode: Leg["mode"], minutes: number, dollars: number): Leg[] {
  const base = { mode, durationMinutes: minutes, pricePerPerson: q(dollars) };
  return [
    { from: a, to: b, ...base },
    { from: b, to: a, ...base },
  ];
}

// [Tokyo, Seoul, Beijing, Hong Kong] one-way price in CAD and minutes, per home airport.
const INTERNATIONAL: Record<string, Record<string, [number, number]>> = {
  YYZ: { tokyo: [950, 780], seoul: [920, 840], beijing: [880, 810], hongkong: [1020, 930] },
  YVR: { tokyo: [780, 640], seoul: [760, 650], beijing: [820, 700], hongkong: [860, 840] },
  YUL: { tokyo: [1000, 830], seoul: [980, 870], beijing: [940, 850], hongkong: [1080, 960] },
};

const international: Leg[] = Object.entries(INTERNATIONAL).flatMap(([home, cities]) =>
  Object.entries(cities).flatMap(([city, [dollars, minutes]]) => [
    flight(home, city, minutes, dollars),
    flight(city, home, minutes, dollars + 30),
  ]),
);

// No Tokyo-Chongqing or Tokyo-Shenzhen service on purpose: the engine must reject those adjacencies.
const intercity: Leg[] = [
  ...pair("tokyo", "seoul", "flight", 130, 190),
  ...pair("tokyo", "beijing", "flight", 240, 320),
  ...pair("tokyo", "hongkong", "flight", 270, 380),
  ...pair("seoul", "beijing", "flight", 120, 180),
  ...pair("seoul", "hongkong", "flight", 215, 290),
  ...pair("seoul", "chongqing", "flight", 200, 310),
  ...pair("seoul", "shenzhen", "flight", 195, 300),
  ...pair("beijing", "chongqing", "flight", 190, 150),
  ...pair("beijing", "shenzhen", "flight", 200, 190),
  ...pair("beijing", "hongkong", "flight", 220, 240),
  ...pair("chongqing", "shenzhen", "flight", 135, 120),
  ...pair("chongqing", "hongkong", "flight", 140, 140),
  ...pair("shenzhen", "hongkong", "train", 40, 15),
];

const pref = (travelerId: string, scores: Record<string, Preference["score"]>): Preference[] =>
  Object.entries(scores).map(([cityId, score]) => ({ travelerId, cityId, score }));

export const asiaDemo: TripInput = {
  currency: CAD,
  startDate: "2027-06-01",
  endDate: "2027-06-15",
  cities: [
    { id: "tokyo", name: "Tokyo", minNights: 3, maxNights: 6 },
    { id: "seoul", name: "Seoul", minNights: 2, maxNights: 4 },
    { id: "beijing", name: "Beijing", minNights: 2, maxNights: 4 },
    { id: "chongqing", name: "Chongqing", minNights: 2, maxNights: 4 },
    { id: "shenzhen", name: "Shenzhen", minNights: 1, maxNights: 2 },
    { id: "hongkong", name: "Hong Kong", minNights: 2, maxNights: 4 },
  ],
  travelers: [
    { id: "alex", name: "Alex", home: "YYZ", budgetCeiling: money(560_000, CAD) },
    { id: "bea", name: "Bea", home: "YYZ", budgetCeiling: money(460_000, CAD) },
    { id: "chen", name: "Chen", home: "YVR", budgetCeiling: money(540_000, CAD) },
    { id: "dana", name: "Dana", home: "YUL", budgetCeiling: money(500_000, CAD) },
  ],
  legs: [...international, ...intercity],
  cityCosts: [
    { cityId: "tokyo", lodgingPerPersonPerNight: q(95), dailySpendPerPerson: q(80) },
    { cityId: "seoul", lodgingPerPersonPerNight: q(75), dailySpendPerPerson: q(65) },
    { cityId: "beijing", lodgingPerPersonPerNight: q(60), dailySpendPerPerson: q(45) },
    { cityId: "chongqing", lodgingPerPersonPerNight: q(50), dailySpendPerPerson: q(35) },
    { cityId: "shenzhen", lodgingPerPersonPerNight: q(55), dailySpendPerPerson: q(40) },
    { cityId: "hongkong", lodgingPerPersonPerNight: q(120), dailySpendPerPerson: q(85) },
  ],
  fixedEvents: [
    { id: "hk-concert", cityId: "hongkong", startDate: "2027-06-12", endDate: "2027-06-12", label: "Concert in Hong Kong" },
  ],
  preferences: [
    ...pref("alex", { tokyo: 2, seoul: 1, beijing: 1, chongqing: 0, shenzhen: 0, hongkong: 2 }),
    ...pref("bea", { tokyo: 1, seoul: 2, beijing: 0, chongqing: -1, shenzhen: -1, hongkong: 2 }),
    ...pref("chen", { tokyo: 2, seoul: 0, beijing: 1, chongqing: 2, shenzhen: 1, hongkong: 2 }),
    ...pref("dana", { tokyo: 1, seoul: 1, beijing: 2, chongqing: 2, shenzhen: 0, hongkong: 2 }),
  ],
};
