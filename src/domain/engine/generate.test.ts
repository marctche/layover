import { describe, expect, it } from "vitest";
import { chainTrip, leg, miniTrip, quote } from "../../../tests/helpers/builders";
import { money } from "../money/money";
import { generateRouteOptions } from "./generate";
import type { TripInput } from "../trip/types";

function codes(r: ReturnType<typeof generateRouteOptions>) {
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("input validation", () => {
  it("rejects more than 8 cities without enumerating", () => {
    const input = miniTrip();
    input.cities = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, minNights: 1 }));
    input.cityCosts = input.cities.map((c) => ({ cityId: c.id, lodgingPerPersonPerNight: quote(1), dailySpendPerPerson: quote(1) }));
    input.legs = [];
    input.preferences = [];
    const r = generateRouteOptions(input);
    expect(codes(r)).toEqual(["too_many_cities"]);
  });

  it("rejects reversed dates", () => {
    const input = { ...miniTrip(), startDate: "2027-06-10", endDate: "2027-06-01" };
    expect(codes(generateRouteOptions(input))).toContain("dates_reversed");
  });

  it("rejects unknown city ids in events, mustInclude and preferences", () => {
    const input: TripInput = {
      ...miniTrip(),
      mustInclude: ["ZZ"],
      fixedEvents: [{ id: "e", cityId: "QQ", startDate: "2027-06-02", endDate: "2027-06-02", label: "x" }],
      preferences: [{ travelerId: "T1", cityId: "NOPE", score: 1 }],
    };
    const r = generateRouteOptions(input);
    expect(codes(r).filter((c) => c === "unknown_city")).toHaveLength(3);
  });

  it("rejects money in another currency", () => {
    const input = miniTrip();
    input.legs[0] = { ...leg("H1", "A", 600, 500), pricePerPerson: { price: money(50_000, "USD"), source: "synthetic" } };
    const r = generateRouteOptions(input);
    expect(codes(r)).toEqual(["currency_mismatch"]);
  });

  it("rejects a budget ceiling in another currency", () => {
    const input = miniTrip();
    input.travelers[0] = { ...input.travelers[0]!, budgetCeiling: money(1, "USD") };
    expect(codes(generateRouteOptions(input))).toEqual(["currency_mismatch"]);
  });

  it("rejects an event on the departure date (no night exists there)", () => {
    const input: TripInput = {
      ...miniTrip(),
      fixedEvents: [{ id: "e", cityId: "B", startDate: "2027-06-06", endDate: "2027-06-06", label: "x" }],
    };
    expect(codes(generateRouteOptions(input))).toEqual(["event_out_of_range"]);
  });
});

describe("value validation", () => {
  it("rejects a negative leg price", () => {
    const input = miniTrip();
    input.legs[4] = { ...input.legs[4]!, pricePerPerson: { price: money(-500_000, "CAD"), source: "manual" } };
    expect(codes(generateRouteOptions(input))).toEqual(["invalid_leg"]);
  });

  it("accepts a free leg but rejects zero, negative or non-finite durations", () => {
    const free = miniTrip();
    free.legs[4] = { ...free.legs[4]!, pricePerPerson: quote(0) };
    expect(generateRouteOptions(free).ok).toBe(true);
    for (const bad of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = miniTrip();
      input.legs[4] = { ...input.legs[4]!, durationMinutes: bad };
      expect(codes(generateRouteOptions(input))).toEqual(["invalid_leg"]);
    }
  });

  it("rejects negative lodging, daily spend and budget ceilings", () => {
    const input = miniTrip();
    input.cityCosts[0] = { ...input.cityCosts[0]!, lodgingPerPersonPerNight: { price: money(-1, "CAD"), source: "manual" } };
    input.cityCosts[1] = { ...input.cityCosts[1]!, dailySpendPerPerson: { price: money(-1, "CAD"), source: "manual" } };
    input.travelers[0] = { ...input.travelers[0]!, budgetCeiling: money(-1, "CAD") };
    expect(codes(generateRouteOptions(input)).sort()).toEqual(["invalid_budget", "invalid_cost", "invalid_cost"]);
  });

  it("rejects preference scores outside -2..2 or not whole", () => {
    for (const score of [3, -3, 1.5]) {
      const input = miniTrip();
      input.preferences[0] = { ...input.preferences[0]!, score: score as never };
      expect(codes(generateRouteOptions(input))).toEqual(["invalid_preference"]);
    }
  });

  it("rejects two preferences from one traveler for one city", () => {
    const input = miniTrip();
    input.preferences.push({ travelerId: "T1", cityId: "A", score: -2 });
    expect(codes(generateRouteOptions(input))).toEqual(["duplicate_id"]);
  });

  it("rejects trips longer than MAX_TRIP_NIGHTS", () => {
    const at = { ...miniTrip(), endDate: "2027-07-31" }; // 60 nights
    expect(codes(generateRouteOptions(at))).not.toContain("trip_too_long");
    const over = { ...miniTrip(), endDate: "2027-08-01" }; // 61 nights
    expect(codes(generateRouteOptions(over))).toContain("trip_too_long");
  });

  it("names both events when two cities need the group on the same night", () => {
    const input: TripInput = {
      ...miniTrip(),
      fixedEvents: [
        { id: "e1", cityId: "A", startDate: "2027-06-02", endDate: "2027-06-03", label: "x" },
        { id: "e2", cityId: "B", startDate: "2027-06-03", endDate: "2027-06-03", label: "y" },
      ],
    };
    const r = generateRouteOptions(input);
    expect(codes(r)).toEqual(["events_conflict"]);
    if (!r.ok) expect(r.errors[0]?.message).toMatch(/"e1".*"e2"/);
  });

  it("allows back-to-back events in different cities", () => {
    const input: TripInput = {
      ...miniTrip(),
      fixedEvents: [
        { id: "e1", cityId: "A", startDate: "2027-06-02", endDate: "2027-06-02", label: "x" },
        { id: "e2", cityId: "B", startDate: "2027-06-03", endDate: "2027-06-03", label: "y" },
      ],
    };
    expect(codes(generateRouteOptions(input))).not.toContain("events_conflict");
  });

  it("rejects a traveler home id that is also a city id", () => {
    const input = miniTrip();
    input.travelers[0] = { ...input.travelers[0]!, home: "A" };
    expect(codes(generateRouteOptions(input))).toContain("home_is_city");
  });
});

describe("ids with punctuation", () => {
  it("handles city ids containing , | > without collisions", () => {
    const ids = ["a,b", "c", "a", "b,c", "x>y", "E"];
    const input: TripInput = {
      currency: "CAD",
      startDate: "2027-06-01",
      endDate: "2027-06-09",
      cities: ids.map((id) => ({ id, name: id, minNights: 1, maxNights: id === "E" ? 8 : 2 })),
      travelers: [{ id: "T", name: "T", home: "H" }],
      legs: ids.flatMap((a) => [leg("H", a, 60, 100), leg(a, "H", 60, 100), ...ids.filter((b) => b !== a).map((b) => leg(a, b, 30, 10))]),
      cityCosts: ids.map((id) => ({ cityId: id, lodgingPerPersonPerNight: quote(50), dailySpendPerPerson: quote(10) })),
      fixedEvents: [{ id: "e", cityId: "E", startDate: "2027-06-04", endDate: "2027-06-06", label: "e" }],
      preferences: [],
      maxAlternatives: 10,
    };
    const r = generateRouteOptions(input);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const routeIds = r.alternatives.map((a) => a.route.id);
    expect(new Set(routeIds).size).toBe(routeIds.length);
    for (const a of r.alternatives) expect(JSON.parse(a.route.id)).toEqual(a.route.stops.map((s) => s.cityId));
  });
});

describe("candidate generation", () => {
  it("rejects a route that lacks a leg between consecutive cities, with the reason", () => {
    const input = miniTrip();
    input.legs = input.legs.filter((l) => !(l.from === "A" && l.to === "B"));
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("no_feasible_route");
    expect(r.errors[0]?.rejections?.missing_leg).toBeGreaterThan(0);
  });

  it("reports a traveler without a home leg as missing_home_leg", () => {
    const input = miniTrip();
    input.legs = input.legs.filter((l) => !(l.from === "H2" && l.to === "A"));
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.rejections?.missing_home_leg).toBeGreaterThan(0);
  });

  it("prunes on minimum nights and says so", () => {
    const input = chainTrip();
    input.cities = input.cities.map((c) => ({ id: c.id, name: c.name, minNights: 4 }));
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.rejections?.min_nights_exceeded).toBeGreaterThan(0);
  });

  it("includes the fixed-event city in every result", () => {
    const input = chainTrip();
    input.mustInclude = [];
    input.fixedEvents = [{ id: "e", cityId: "C", startDate: "2027-06-05", endDate: "2027-06-05", label: "show" }];
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const a of r.alternatives) {
      const c = a.route.stops.find((s) => s.cityId === "C");
      expect(c).toBeDefined();
      expect(c!.firstNight).toBeLessThanOrEqual(4);
      expect(c!.firstNight + c!.nights - 1).toBeGreaterThanOrEqual(4);
    }
  });

  it("does not mutate its input and is deterministic", () => {
    const input = chainTrip();
    const copy = structuredClone(input);
    const a = generateRouteOptions(input);
    const b = generateRouteOptions(input);
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
  });

  it("returns a single plan with stop dates for a forced route", () => {
    const r = generateRouteOptions(miniTrip());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives[0]?.route.stops).toEqual([
      { cityId: "A", nights: 3, firstNight: 0, checkIn: "2027-06-01", checkOut: "2027-06-04" },
      { cityId: "B", nights: 2, firstNight: 3, checkIn: "2027-06-04", checkOut: "2027-06-06" },
    ]);
  });
});
