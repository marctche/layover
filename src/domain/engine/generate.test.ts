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
