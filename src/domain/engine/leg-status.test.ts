import { describe, expect, it } from "vitest";
import { miniTrip } from "../../../tests/helpers/builders";
import { generateRouteOptions } from "./generate";
import type { TripInput } from "../trip/types";

// Alpha near Tokyo, Bravo in Seoul: about 1160 km, so a flight estimate.
const located = (): TripInput => {
  const t = miniTrip();
  t.cities = [
    { ...t.cities[0]!, lat: 35.68, lng: 139.69 },
    { ...t.cities[1]!, lat: 37.57, lng: 126.98 },
  ];
  return t;
};
const withoutAB = (t: TripInput): TripInput => ({ ...t, legs: t.legs.filter((l) => !(l.from === "A" && l.to === "B")) });
const codes = (r: ReturnType<typeof generateRouteOptions>) => (r.ok ? [] : r.errors.map((e) => e.code));

describe("unpriced intercity legs", () => {
  it("estimates a pair with coordinates and labels the route", () => {
    const r = generateRouteOptions(withoutAB(located()));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const route = r.alternatives[0]!.route;
    expect(route.metrics.estimatedLegs).toEqual([{ from: "A", to: "B" }]);
    expect(route.metrics.priceSources).toContain("estimate");
    expect(route.intercityLegs[0]?.pricePerPerson.provider).toBe("distance-heuristic");
    expect(r.rejections.leg_unpriced).toBe(0);
  });

  it("prunes a pair in unavailablePairs even with coordinates, counted as leg_unavailable", () => {
    const input = { ...withoutAB(located()), unavailablePairs: [{ from: "A", to: "B" }] };
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("no_feasible_route");
    expect(r.errors[0]?.rejections?.leg_unavailable).toBeGreaterThan(0);
    expect(r.errors[0]?.rejections?.leg_unpriced).toBe(0);
  });

  it("prunes a pair with no coordinates and no quote as leg_unpriced", () => {
    const r = generateRouteOptions(withoutAB(miniTrip()));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.rejections?.leg_unpriced).toBeGreaterThan(0);
    expect(r.errors[0]?.rejections?.leg_unavailable).toBe(0);
  });

  it("leaves estimatedLegs empty when the route uses a real quote", () => {
    const r = generateRouteOptions(located());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    for (const a of r.alternatives) expect(a.route.metrics.estimatedLegs).toEqual([]);
  });

  it("prefers a real quote over unavailablePairs", () => {
    const input = { ...located(), unavailablePairs: [{ from: "A", to: "B" }] };
    const r = generateRouteOptions(input);
    expect(r.ok).toBe(true);
  });
});

describe("coordinate and unavailablePairs validation", () => {
  it("rejects out-of-range or half-specified coordinates", () => {
    for (const patch of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: Number.NaN, lng: 0 }, { lat: 10 }]) {
      const t = miniTrip();
      t.cities[0] = { ...t.cities[0]!, ...patch };
      expect(codes(generateRouteOptions(t))).toEqual(["invalid_city"]);
    }
  });

  it("rejects unavailablePairs with unknown ids or the same city twice", () => {
    const unknown = { ...miniTrip(), unavailablePairs: [{ from: "A", to: "Z" }] };
    expect(codes(generateRouteOptions(unknown))).toEqual(["unknown_city"]);
    const same = { ...miniTrip(), unavailablePairs: [{ from: "A", to: "A" }] };
    expect(codes(generateRouteOptions(same))).toEqual(["invalid_option"]);
  });
});
